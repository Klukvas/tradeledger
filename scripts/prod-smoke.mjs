import process from 'node:process'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { request } from 'node:https'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { context, run, root, sql } from './prod-common.mjs'
import { deploy } from './prod-stack.mjs'
import { backup } from './prod-backup.mjs'
import { restoreCheck, tableCounts } from './prod-restore-check.mjs'

async function freePort() {
  const server = createServer()
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}
function httpsCall(origin, ca, path, { method = 'GET', body, cookie, wrongOrigin, userId } = {}) {
  return new Promise((resolveResponse, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const req = request(`${origin}${path}`, { method, ca, headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...(method !== 'GET' ? { Origin: wrongOrigin ?? origin, 'X-TradeLedger-Request': '1' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(userId ? { 'X-TradeLedger-User': userId } : {}),
    } }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, text }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('HTTPS timeout')))
    req.on('error', reject)
    req.end(payload)
  })
}
const project = `tradeledger-prod-smoke-${Date.now()}`
const port = await freePort()
const release = process.env.TRADELEDGER_SMOKE_RELEASE ?? `smoke-${Date.now()}-${randomBytes(4).toString('hex')}`
const values = {
  PUBLIC_ORIGIN: `https://localhost:${port}`,
  TRADELEDGER_DB_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
  TRADELEDGER_DB_APP_PASSWORD: randomBytes(32).toString('hex'),
  TRADELEDGER_BIND: '127.0.0.1', TRADELEDGER_HTTP_PORT: String(await freePort()), TRADELEDGER_HTTPS_PORT: String(port),
  TRADELEDGER_CADDYFILE: './deploy/Caddyfile.smoke',
}
const ctx = await context({ values, project, smoke: true, release })
try {
  await deploy(ctx, { build: !process.env.TRADELEDGER_SMOKE_RELEASE })
  let ca
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await ctx.compose(['exec', '-T', 'caddy', 'cat', '/data/caddy/pki/authorities/local/root.crt'], { allowFailure: true })
    if (result.code === 0) { ca = result.output; break }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  assert.ok(ca, 'internal CA root must exist')
  const cache = join(root, '.cache', project)
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, 'root.crt'), ca)
  let ready
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ready = await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/health/ready').catch(() => null)
    if (ready?.status === 200) break
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  assert.equal(ready?.status, 200, 'trusted HTTPS readiness')
  assert.equal((await httpsCall(values.PUBLIC_ORIGIN, ca, '/')).status, 200)
  const credentials = { email: `smoke-${Date.now()}@example.invalid`, password: randomBytes(24).toString('hex') }
  const deniedRegistration = await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/auth/register', { method: 'POST', body: credentials })
  assert.equal(deniedRegistration.status, 403)
  assert.equal(JSON.parse(deniedRegistration.text).error.message, 'Доступ предоставляет владелец TradeLedger.')
  assert.equal((await sql(ctx, 'SELECT count(*) FROM "User";')).output.trim(), '0')
  await ctx.compose(['exec', '-T', 'api', 'node', 'scripts/prod-create-user.mjs'], { input: JSON.stringify(credentials) })
  const sessions = await sql(ctx, 'SELECT count(*) FROM "Session" WHERE "revokedAt" IS NULL;')
  assert.equal(sessions.output.trim(), '0', 'CLI leaves no usable session')
  const login = await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/auth/login', { method: 'POST', body: credentials })
  assert.equal(login.status, 200)
  const setCookie = login.headers['set-cookie']?.[0] ?? ''
  assert.match(setCookie, /; Secure/i)
  assert.match(setCookie, /; HttpOnly/i)
  assert.match(setCookie, /; SameSite=Lax/i)
  const cookie = setCookie.split(';')[0]
  const userId = JSON.parse(login.text).value.user.id
  assert.equal((await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/auth/login', { method: 'POST', body: credentials, wrongOrigin: 'https://wrong.example.invalid' })).status, 403)
  for (const service of ['db', 'api', 'web']) {
    const id = (await ctx.compose(['ps', '-q', service])).output.trim()
    const ports = await run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', id])
    assert.ok(['null', '{}'].includes(ports.output.trim()), `${service} must have no host bindings`)
  }
  const command = { expectedRevision: 0, command: { type: 'account.create', id: 'smoke-account', name: 'Restore proof', owner: 'Fixture', provider: 'other', balanceMinor: 123456,
    meta: { commandId: 'smoke-create-account', at: new Date().toISOString() } } }
  const changed = await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/ledger/commands', { method: 'POST', cookie, userId, body: command })
  assert.equal(changed.status, 200, 'business record created through HTTPS API')
  const currentCounts = await tableCounts(ctx, 'tradeledger')
  assert.ok(currentCounts.includes('User|1'))
  assert.ok(currentCounts.includes('Workspace|1'))
  assert.ok(currentCounts.includes('Account|1'))
  const path = await backup(ctx)
  const restored = await restoreCheck(ctx, path)
  assert.deepEqual(restored.counts, currentCounts, 'all public table counts survive portable restore')
  assert.deepEqual(await tableCounts(ctx, 'tradeledger'), currentCounts, 'restore leaves source database unchanged')
  const restoredAdmin = ctx.env.TRADELEDGER_ADMIN_DATABASE_URL.replace('/tradeledger?', `/${restored.database}?`)
  await ctx.compose(['run', '--rm', '--no-deps', '-e', 'DATABASE_URL', 'migrate', 'node', 'scripts/post-migrate-grants.mjs'], { env: { DATABASE_URL: restoredAdmin } })
  const restoredApp = ctx.env.TRADELEDGER_APP_DATABASE_URL.replace('/tradeledger?', `/${restored.database}?`)
  const loginProof = `const {NestFactory}=require('@nestjs/core'); const {AppModule}=require('./server/dist/server/src/app.module.js');
    const {AuthService,parseCredentials}=require('./server/dist/server/src/auth/auth.service.js');
    (async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;
    const app=await NestFactory.createApplicationContext(AppModule,{logger:false,abortOnError:false});
    try{const auth=app.get(AuthService);const session=await auth.login(parseCredentials(JSON.parse(input)));await auth.authenticate(session.token);await auth.logout(session.token);process.stdout.write('Restored account login verified.\\n')}finally{await app.close()}})().catch(()=>process.exit(1))`
  await ctx.compose(['exec', '-T', '-e', 'DATABASE_URL', 'api', 'node', '-e', loginProof], { env: { DATABASE_URL: restoredApp }, input: JSON.stringify(credentials) })

  const restoredEmail = await sql(ctx, 'SELECT email FROM "User";', restored.database)
  assert.equal(restoredEmail.output.trim(), credentials.email)
  assert.equal((await sql(ctx, 'SELECT "balanceMinor" FROM "Account";', restored.database)).output.trim(), '123456')
  await ctx.compose(['stop'])
  await ctx.compose(['start', 'db', 'api', 'web', 'caddy'])
  for (let attempt = 0; attempt < 45; attempt += 1) {
    ready = await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/health/ready').catch(() => null)
    if (ready?.status === 200) break
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  assert.equal(ready?.status, 200)
  assert.equal((await httpsCall(values.PUBLIC_ORIGIN, ca, '/api/auth/me', { cookie })).status, 200, 'session/account persist after stop/start')
  process.stdout.write(`PASS: HTTPS, frontend, closed registration, CLI account, secure cookies, Origin check, private ports, full backup/restore and restart persistence. Project ${project}; restored database ${restored.database}.\n`)
} catch (error) {
  process.stderr.write(`Smoke failed: ${error.message}; isolated project ${project} retained for diagnosis.\n`)
  process.exitCode = 1
} finally {
  await ctx.compose(['stop']).catch(() => { process.stderr.write('Could not stop isolated smoke project.\n') })
  process.stdout.write('Smoke resources and database retained, stopped; no production/local volume removed.\n')
}
