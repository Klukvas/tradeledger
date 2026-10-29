import process from 'node:process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile, mkdir, stat, writeFile, rename, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export function safeError(message) { return new Error(message) }

export async function run(command, args, { env = process.env, input, quiet = true, allowFailure = false, outputFile } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['pipe', outputFile ?? 'pipe', 'pipe'] })
    const progress = setInterval(() => process.stdout.write(`${command} operation still running...\n`), 30_000)
    let output = ''
    let errors = ''
    if (child.stdout) child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { errors += chunk.toString() })
    child.on('error', () => { clearInterval(progress); reject(safeError(`Unable to start ${command}`)) })
    child.on('close', code => {
      clearInterval(progress)
      // Tools can echo SQL, credentials and expanded Compose config. Never relay their output on failure.
      if (code !== 0 && !allowFailure) reject(safeError(`${command} ${args[0] ?? ''} failed (exit ${code}); output withheld to protect credentials`))
      else {
        if (!quiet) process.stdout.write(output)
        resolveResult({ code, output, errors })
      }
    })
    child.stdin.on('error', () => {})
    if (input?.pipe) { input.on('error', () => child.kill()); input.pipe(child.stdin) }
    else child.stdin.end(input)
  })
}

export function validateConfig(values, { smoke = false } = {}) {
  let origin
  try { origin = new URL(values.PUBLIC_ORIGIN) } catch { throw safeError('PUBLIC_ORIGIN must be an exact HTTPS origin') }
  const tlsMode = values.PUBLIC_TLS_MODE || 'domain'
  if (!['domain', 'ip'].includes(tlsMode)) throw safeError('PUBLIC_TLS_MODE must be domain or ip')
  if (origin.protocol !== 'https:' || origin.origin !== values.PUBLIC_ORIGIN || origin.username || origin.password ||
      (!smoke && (origin.port || (tlsMode === 'ip' ? !isPublicIPv4(origin.hostname) :
        !origin.hostname.includes('.') || isIP(origin.hostname) || /^(localhost|127\.|0\.|\[)/.test(origin.hostname))))) {
    throw safeError('PUBLIC_ORIGIN must be an exact HTTPS domain origin, or public IPv4 with PUBLIC_TLS_MODE=ip, without path or port')
  }
  for (const key of ['TRADELEDGER_DB_ADMIN_PASSWORD', 'TRADELEDGER_DB_APP_PASSWORD']) {
    if (!/^[a-f0-9]{64}$/.test(values[key] ?? '')) throw safeError(`${key} must contain 64 random lowercase hex characters`)
  }
  if (values.TRADELEDGER_DB_ADMIN_PASSWORD === values.TRADELEDGER_DB_APP_PASSWORD) throw safeError('Database passwords must differ')
  return { ...values }
}

function isPublicIPv4(host) {
  if (isIP(host) !== 4) return false
  const [a, b, c] = host.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113))
}

export async function readConfig() {
  const path = join(root, '.env.production')
  const info = await stat(path).catch(() => { throw safeError('Create .env.production on the server first; see deploy/production.md') })
  if ((info.mode & 0o077) !== 0 || !info.isFile()) throw safeError('.env.production must be a regular file readable only by its owner (chmod 600)')
  const text = await readFile(path, 'utf8')
  const entries = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) throw safeError('Invalid production environment format; use KEY=value without shell syntax')
    return [match[1], match[2]]
  })
  return validateConfig(Object.fromEntries(entries))
}

export async function context({ values, project = 'tradeledger-prod', smoke = false, release = 'unselected' } = {}) {
  if (project !== 'tradeledger-prod' && !(smoke && /^tradeledger-prod-smoke-[a-z0-9-]+$/.test(project))) throw safeError('Unexpected production project name')
  const config = validateConfig(values ?? await readConfig(), { smoke })
  if (!/^[a-z0-9][a-z0-9-]{5,80}$/.test(release)) throw safeError('Invalid release identifier')
  const env = { ...process.env, ...config,
    PUBLIC_HOST: new URL(config.PUBLIC_ORIGIN).hostname,
    ...(smoke ? {} : { TRADELEDGER_BIND: '0.0.0.0', TRADELEDGER_HTTP_PORT: '80', TRADELEDGER_HTTPS_PORT: '443', TRADELEDGER_CADDYFILE: config.PUBLIC_TLS_MODE === 'ip' ? './deploy/Caddyfile.ip' : './deploy/Caddyfile' }),
    COMPOSE_IGNORE_ORPHANS: 'true', COMPOSE_DISABLE_ENV_FILE: 'true', TRADELEDGER_RELEASE: release,
    TRADELEDGER_ADMIN_DATABASE_URL: `postgresql://tradeledger_admin:${config.TRADELEDGER_DB_ADMIN_PASSWORD}@db:5432/tradeledger?schema=public`,
    TRADELEDGER_APP_DATABASE_URL: `postgresql://tradeledger_app:${config.TRADELEDGER_DB_APP_PASSWORD}@db:5432/tradeledger?schema=public`,
  }
  const compose = (args, options = {}) => run('docker', ['compose', '--project-name', project, '--env-file', '/dev/null', '-f', 'compose.production.yaml', ...args], { ...options, env: { ...env, ...options.env } })
  const state = join(root, '.production-state', project)
  await mkdir(state, { recursive: true, mode: 0o700 })
  return { config, env, compose, project, state, smoke }
}

export async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}
export async function readState(ctx) {
  return JSON.parse(await readFile(join(ctx.state, 'release.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return 'null'
    throw error
  }))
}
export async function validateCompose(ctx) { await ctx.compose(['config', '--quiet']); process.stdout.write('Production configuration valid (values withheld).\n') }
export async function databaseContainer(ctx) {
  const result = await ctx.compose(['ps', '-a', '-q', 'db'])
  const id = result.output.trim()
  if (!id) throw safeError('Production database container is absent')
  return id
}
export async function sql(ctx, query, database = 'tradeledger') {
  return ctx.compose(['exec', '-T', 'db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'tradeledger_admin', '-d', database], { input: query })
}
export function assertProductionStorage(project, container, volume) {
  const expected = `${project}_database`
  const directory = '/var/lib/postgresql/data'
  const mounts = container.mounts.filter(mount => typeof mount.Destination === 'string' && (
    mount.Destination === directory || mount.Destination.startsWith(`${directory}/`) || directory.startsWith(`${mount.Destination}/`)))
  if (container.project !== project || container.pgdata !== 'PGDATA=/var/lib/postgresql/data' || mounts.length !== 1 || mounts[0].Type !== 'volume' ||
      mounts[0].Name !== expected || mounts[0].Destination !== directory || volume.Name !== expected ||
      volume.Labels?.['com.docker.compose.project'] !== project || volume.Labels?.['com.docker.compose.volume'] !== 'database') {
    throw safeError('Production database storage ownership/mount cannot be verified; preserving all data')
  }
}
export async function assertDatabaseOwnership(ctx) {
  const existing = await ctx.compose(['ps', '-a', '-q', 'db'])
  const volume = await run('docker', ['volume', 'inspect', `${ctx.project}_database`], { allowFailure: true })
  if (volume.code !== 0 && !/no such volume/i.test(volume.errors)) throw safeError('Database volume inspection failed; preserving all data')
  if (volume.code === 0 && !existing.output.trim()) throw safeError('Database volume exists without its container; recover the original configuration before continuing')
  if (existing.output.trim()) {
    if (volume.code !== 0) throw safeError('Database container exists without expected volume; preserving all data')
    const inspected = await run('docker', ['inspect', '--format', '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"mounts":{{json .Mounts}},"pgdata":"{{range .Config.Env}}{{if eq . "PGDATA=/var/lib/postgresql/data"}}PGDATA=/var/lib/postgresql/data{{end}}{{end}}"}', existing.output.trim()])
    assertProductionStorage(ctx.project, JSON.parse(inspected.output), JSON.parse(volume.output)[0])
  }
}
export async function waitDatabase(ctx) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    // The initial PostgreSQL setup daemon serves only a Unix socket; wait for the final TCP daemon.
    const result = await ctx.compose(['exec', '-T', 'db', 'pg_isready', '-h', '127.0.0.1', '-U', 'tradeledger_admin', '-d', 'tradeledger'], { allowFailure: true })
    if (result.code === 0) return
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  throw safeError('Production database did not become ready within 60 seconds')
}
export async function bootstrap(ctx) {
  // Validated random hex only; password travels on stdin, never SQL argv or output.
  await sql(ctx, `SET log_statement='none'; SET log_min_error_statement='panic';
    DO $bootstrap$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='tradeledger_app') THEN
      CREATE ROLE tradeledger_app LOGIN PASSWORD '${ctx.config.TRADELEDGER_DB_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    END $bootstrap$;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE tradeledger TO tradeledger_app;
    GRANT USAGE ON SCHEMA public TO tradeledger_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE tradeledger_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO tradeledger_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE tradeledger_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tradeledger_app;`)
  const role = await sql(ctx, "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='tradeledger_app';")
  if (role.output.trim() !== 'f') throw safeError('Application role has unexpected elevated privileges; preserving role without alteration')
  for (const [user, password] of [['tradeledger_admin', ctx.config.TRADELEDGER_DB_ADMIN_PASSWORD], ['tradeledger_app', ctx.config.TRADELEDGER_DB_APP_PASSWORD]]) {
    await ctx.compose(['exec', '-T', '-e', 'PGPASSWORD', 'db', 'psql', '-X', '-qAt', '-h', '127.0.0.1', '-U', user, '-d', 'tradeledger', '-c', 'SELECT 1'], { env: { ...ctx.env, PGPASSWORD: password } })
  }
}
export function within(path, directory) {
  const absolute = resolve(path)
  if (!absolute.startsWith(`${resolve(directory)}/`)) throw safeError('Backup must be inside this project production backup directory')
  return absolute
}

export async function withOperation(ctx, action) {
  const { open } = await import('node:fs/promises')
  const path = join(ctx.state, 'operation.lock')
  const lock = await open(path, 'wx', 0o600).catch(() => { throw safeError('Production operation lock exists; verify no operation is running before removing only that lock') })
  try { return await action() } finally { await lock.close(); await unlink(path) }
}

export async function fileChecksum(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
