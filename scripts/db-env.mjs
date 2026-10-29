import process from 'node:process'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
const owner = 'tradeledger-local-stack-v1'
const containerName = 'tradeledger-db'
const volumeName = 'tradeledger-postgres-v1'
const dataDirectory = '/var/lib/postgresql/data'

export function redact(text, secrets = []) {
  return secrets.filter(Boolean).reduce((value, secret) => value.split(secret).join('[REDACTED]'), text)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]')
}

export async function run(command, args, { env = process.env, input, secrets = [], quiet = false, allowFailure = false, inheritInput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: [inheritInput ? 'inherit' : 'pipe', 'pipe', 'pipe'] })
    // Redact complete lines so secrets split across output chunks stay protected.
    let output = ''
    let errors = ''
    const writeLines = stream => {
      let pending = ''
      return {
        write(chunk) {
          pending += chunk.toString()
          const end = pending.lastIndexOf('\n')
          if (end >= 0) {
            stream.write(redact(pending.slice(0, end + 1), secrets))
            pending = pending.slice(end + 1)
          }
        },
        flush() { if (pending) stream.write(redact(pending, secrets)) },
      }
    }
    const stdout = writeLines(process.stdout)
    const stderr = writeLines(process.stderr)
    child.stdout.on('data', chunk => { output += chunk.toString(); if (!quiet) stdout.write(chunk) })
    child.stderr.on('data', chunk => { errors += chunk.toString(); if (!quiet) stderr.write(chunk) })
    child.on('error', () => reject(new Error(`Unable to start ${command}`)))
    child.on('close', code => {
      if (!quiet) {
        stdout.flush()
        stderr.flush()
      }
      if (code !== 0 && !allowFailure) reject(new Error(`${command} failed (exit ${code}); ${redact(errors, secrets)}`))
      else resolve({ code, output, errors })
    })
    if (!inheritInput) child.stdin.end(input)
  })
}

export function assertStorageOwnership(container, volume) {
  const mounts = Array.isArray(container?.Mounts) ? container.Mounts : []
  const dataMounts = mounts.filter(mount => typeof mount.Destination === 'string' && (
    mount.Destination === dataDirectory || mount.Destination.startsWith(`${dataDirectory}/`) ||
    dataDirectory.startsWith(`${mount.Destination}/`)
  ))
  if (dataMounts.length !== 1 || dataMounts[0].Destination !== dataDirectory ||
      dataMounts[0].Type !== 'volume' || dataMounts[0].Name !== volumeName) {
    throw new Error('Database data mount is not the expected local-stack volume; preserving all data')
  }
  if (volume?.Name !== volumeName || volume.Labels?.['com.tradeledger.owner'] !== owner ||
      volume.Labels?.['com.docker.compose.project'] !== 'tradeledger' ||
      volume.Labels?.['com.docker.compose.volume'] !== 'database') {
    throw new Error('Database volume ownership cannot be verified; preserving all data')
  }
}

export async function credentials({ create = false } = {}) {
  const result = await run('docker', ['container', 'inspect', containerName], { quiet: true, allowFailure: true })
  if (result.code === 0) {
    const [container] = JSON.parse(result.output)
    if (container.Config.Labels?.['com.tradeledger.owner'] !== owner ||
        container.Config.Labels?.['com.docker.compose.project'] !== 'tradeledger') {
      throw new Error('tradeledger-db exists but is not owned by this local stack; preserving it')
    }
    const inspectedVolume = await run('docker', ['volume', 'inspect', volumeName], { quiet: true, allowFailure: true })
    if (inspectedVolume.code !== 0) throw new Error('Cannot inspect the existing database volume; preserving all data')
    const [volume] = JSON.parse(inspectedVolume.output)
    assertStorageOwnership(container, volume)
    const env = Object.fromEntries(container.Config.Env.map(item => {
      const at = item.indexOf('=')
      return [item.slice(0, at), item.slice(at + 1)]
    }))
    if (!env.POSTGRES_PASSWORD || !env.TRADELEDGER_DB_APP_PASSWORD ||
        env.POSTGRES_USER !== 'tradeledger_admin' || env.POSTGRES_DB !== 'tradeledger' || env.PGDATA !== dataDirectory) {
      throw new Error('Existing database credentials/configuration cannot be recovered; preserving data')
    }
    return { admin: env.POSTGRES_PASSWORD, app: env.TRADELEDGER_DB_APP_PASSWORD }
  }
  if (!result.errors.includes('No such container') && !result.errors.includes('No such object')) {
    throw new Error('Docker inspection failed; check that Docker Desktop is running')
  }
  if (!create) throw new Error('Start the database first: node scripts/local-stack.mjs db')
  const volume = await run('docker', ['volume', 'inspect', volumeName], { quiet: true, allowFailure: true })
  if (volume.code === 0) throw new Error('Database volume exists without its credential container; preserving data. Recover the original container/configuration before starting.')
  if (!volume.errors.toLowerCase().includes('no such volume')) throw new Error('Cannot verify database volume ownership')
  return { admin: randomBytes(32).toString('hex'), app: randomBytes(32).toString('hex') }
}

export function databaseUrl(password, { admin = false, docker = false } = {}) {
  return `postgresql://${admin ? 'tradeledger_admin' : 'tradeledger_app'}:${encodeURIComponent(password)}@${docker ? 'db:5432' : '127.0.0.1:5439'}/tradeledger?schema=public`
}

export function composeEnvironment(keys) {
  return { ...process.env,
    TRADELEDGER_DB_ADMIN_PASSWORD: keys.admin,
    TRADELEDGER_DB_APP_PASSWORD: keys.app,
    TRADELEDGER_ADMIN_DATABASE_URL: databaseUrl(keys.admin, { admin: true, docker: true }),
    TRADELEDGER_APP_DATABASE_URL: databaseUrl(keys.app, { docker: true }),
  }
}

export async function bootstrap(keys) {
  if (!/^[a-f0-9]{64}$/.test(keys.app)) throw new Error('Unexpected local application credential format')
  // The generated hex password travels only on stdin, never in command arguments or files.
  const sql = `DO $bootstrap$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tradeledger_app') THEN
      CREATE ROLE tradeledger_app LOGIN PASSWORD '${keys.app}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END $bootstrap$;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT CONNECT ON DATABASE tradeledger TO tradeledger_app;
  GRANT USAGE ON SCHEMA public TO tradeledger_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE tradeledger_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO tradeledger_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE tradeledger_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tradeledger_app;`
  await run('docker', ['exec', '-i', containerName, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'tradeledger_admin', '-d', 'tradeledger'], {
    input: sql, secrets: [keys.admin, keys.app], quiet: true,
  })
}
