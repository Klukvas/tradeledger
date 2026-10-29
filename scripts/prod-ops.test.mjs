import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rmdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateConfig, assertProductionStorage, within, run, withOperation, waitDatabase, root } from './prod-common.mjs'

const config = { PUBLIC_ORIGIN: 'https://ledger.example.com', TRADELEDGER_DB_ADMIN_PASSWORD: 'a'.repeat(64), TRADELEDGER_DB_APP_PASSWORD: 'b'.repeat(64) }
test('production config requires exact HTTPS domain and distinct random hex keys', () => {
  assert.deepEqual(validateConfig(config), config)
  for (const origin of ['http://ledger.example.com', 'https://ledger.example.com/', 'https://localhost', 'https://ledger.example.com:9443', 'https://a:b@ledger.example.com']) {
    assert.throws(() => validateConfig({ ...config, PUBLIC_ORIGIN: origin }))
  }
  assert.throws(() => validateConfig({ ...config, TRADELEDGER_DB_APP_PASSWORD: config.TRADELEDGER_DB_ADMIN_PASSWORD }))
  assert.throws(() => validateConfig({ ...config, TRADELEDGER_DB_APP_PASSWORD: "'); DROP ROLE x; --" }))
  assert.throws(() => validateConfig({ ...config, TRADELEDGER_DB_APP_PASSWORD: '' }))
})
test('IP HTTPS is explicit and accepts only canonical public IPv4 origins', () => {
  const ipConfig = { ...config, PUBLIC_TLS_MODE: 'ip', PUBLIC_ORIGIN: 'https://178.105.103.119' }
  assert.deepEqual(validateConfig(ipConfig), ipConfig)
  assert.throws(() => validateConfig({ ...config, PUBLIC_ORIGIN: ipConfig.PUBLIC_ORIGIN }))
  assert.throws(() => validateConfig({ ...ipConfig, PUBLIC_TLS_MODE: 'internal' }))
  for (const origin of [
    'https://ledger.example.com', 'http://178.105.103.119', 'https://178.105.103.119/',
    'https://178.105.103.119:9443', 'https://user:pass@178.105.103.119',
    'https://127.0.0.1', 'https://0.0.0.0', 'https://10.0.0.1', 'https://169.254.1.1',
    'https://172.16.0.1', 'https://192.168.0.1', 'https://100.64.0.1',
    'https://192.0.0.1', 'https://192.0.2.1', 'https://192.88.99.1', 'https://198.18.0.1',
    'https://198.51.100.1', 'https://203.0.113.1', 'https://224.0.0.1', 'https://255.255.255.255',
    'https://[::1]', 'https://[2606:4700:4700::1111]', 'https://0xb2696777',
  ]) assert.throws(() => validateConfig({ ...ipConfig, PUBLIC_ORIGIN: origin }), origin)
  assert.doesNotThrow(() => validateConfig({ ...config, PUBLIC_TLS_MODE: 'domain' }))
  assert.doesNotThrow(() => validateConfig({ ...config, PUBLIC_ORIGIN: 'https://localhost:9443' }, { smoke: true }))
})
test('first-boot database probes wait for TCP instead of the temporary init Unix socket', async () => {
  await waitDatabase({ compose: async args => {
    assert.equal(args[args.indexOf('-h') + 1], '127.0.0.1', 'host readiness must use TCP')
    return { code: 0 }
  } })
  const compose = await readFile(join(root, 'compose.production.yaml'), 'utf8')
  assert.match(compose, /pg_isready -h 127\.0\.0\.1 -U tradeledger_admin -d tradeledger/, 'container health must also use TCP')
})
const project = 'tradeledger-prod'
const volume = { Name: `${project}_database`, Labels: { 'com.docker.compose.project': project, 'com.docker.compose.volume': 'database' } }
const container = { project, pgdata: 'PGDATA=/var/lib/postgresql/data', mounts: [{ Type: 'volume', Name: volume.Name, Destination: '/var/lib/postgresql/data' }] }
test('storage checks reject foreign volume, bind mounts, nested mounts and alternate PGDATA', () => {
  assert.doesNotThrow(() => assertProductionStorage(project, container, volume))
  for (const changed of [
    { ...container, project: 'tradeledger' },
    { ...container, pgdata: '' },
    { ...container, mounts: [{ ...container.mounts[0], Type: 'bind' }] },
    { ...container, mounts: [{ ...container.mounts[0], Name: 'tradeledger-postgres-v1' }] },
    { ...container, mounts: [...container.mounts, { Type: 'bind', Destination: '/var/lib/postgresql/data/base' }] },
  ]) assert.throws(() => assertProductionStorage(project, changed, volume))
  assert.throws(() => assertProductionStorage(project, container, { ...volume, Labels: {} }))
})
test('restore check confines archive to the selected project', () => {
  assert.equal(within('/srv/app/backups/a.dump', '/srv/app/backups'), '/srv/app/backups/a.dump')
  assert.throws(() => within('/srv/app/backups/../foreign.dump', '/srv/app/backups'))
  assert.throws(() => within('/srv/app/backups-other/a.dump', '/srv/app/backups'))
})
test('failed subprocess output does not leak sensitive values', async () => {
  await assert.rejects(run(process.execPath, ['-e', "process.stderr.write('sensitive credential'); process.exit(2)"]), error => {
    assert.doesNotMatch(error.message, /sensitive credential/)
    return true
  })
})

test('shared operation lock refuses overlapping actions and releases after failure', async () => {
  const directory = join(root, '.cache', `prod-lock-test-${process.pid}`)
  await mkdir(directory, { recursive: true })
  const ctx = { state: directory }
  try {
    await withOperation(ctx, async () => {
      await assert.rejects(withOperation(ctx, async () => {}), /operation lock exists/)
    })
    await assert.rejects(withOperation(ctx, async () => { throw new Error('fixture failure') }), /fixture failure/)
    await withOperation(ctx, async () => {})
  } finally { await rmdir(directory) }
})

test('actual launch probes terminate established but stalled HTTP responses', { timeout: 12_000 }, async () => {
  const { createServer } = await import('node:http')
  const { launch } = await import('./prod-stack.mjs')
  let requests = 0
  const server = createServer(() => { requests += 1 })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = `http://127.0.0.1:${server.address().port}/api/health/ready`
  try {
    await Promise.all(['node', 'curl'].map(async command => {
      const ctx = { smoke: true, compose: async args => {
        const index = args.indexOf(command)
        if (args[0] === 'exec' && index >= 0) {
          const actual = args.slice(index + 1).map(value => value.replace(/http:\/\/127\.0\.0\.1:(?:5180|8080)(?:\/api\/health\/ready|\/)/g, address))
          const result = await run(command === 'node' ? process.execPath : command, actual, { allowFailure: true })
          assert.notEqual(result.code, 0, `${command} must time out`)
          throw new Error(`${command} stalled probe finished`)
        }
        return { code: 0, output: '' }
      } }
      await assert.rejects(launch(ctx), new RegExp(`${command} stalled probe finished`))
    }))
    assert.ok(requests >= 2, 'both probes reached the connected HTTP server')
  } finally {
    server.closeAllConnections()
    await new Promise(resolveClose => server.close(resolveClose))
  }
})
