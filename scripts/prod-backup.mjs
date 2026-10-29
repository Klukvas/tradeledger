import process from 'node:process'
import { createReadStream } from 'node:fs'
import { open, mkdir, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { context, run, atomicJson, safeError, fileChecksum } from './prod-common.mjs'

export async function backup(ctx) {
  const directory = join(ctx.state, 'backups')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const filename = `tradeledger-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.dump`
  const target = join(directory, filename)
  const temporary = `${target}.partial`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await ctx.compose(['exec', '-T', 'db', 'pg_dump', '-U', 'tradeledger_admin', '-d', 'tradeledger', '--format=custom', '--no-owner', '--no-acl'], { outputFile: handle.fd })
    await handle.sync()
  } finally { await handle.close() }
  if ((await stat(temporary)).size < 100) throw safeError('Backup output was unexpectedly small; partial file retained for diagnosis')
  await ctx.compose(['exec', '-T', 'db', 'pg_restore', '--list'], { input: createReadStream(temporary) })
  await rename(temporary, target)
  const sha256 = await fileChecksum(target)
  await atomicJson(`${target}.json`, { version: 1, project: ctx.project, filename, sha256, createdAt: new Date().toISOString() })
  process.stdout.write(`PostgreSQL backup complete: ${target}\n`)
  return target
}

export async function offhostBackup(path) {
  if (!process.env.RESTIC_REPOSITORY) return
  if (!process.env.RESTIC_PASSWORD_COMMAND) throw safeError('Off-host backup requires RESTIC_PASSWORD_COMMAND from protected host configuration')
  if (!process.env.RESTIC_REPOSITORY.startsWith('sftp:')) throw safeError('Prepared off-host transport supports a restic sftp repository only')
  const env = { ...process.env, RESTIC_PASSWORD: '', RESTIC_PASSWORD_FILE: '' }
  // Pin host keys in the service user's known_hosts before enabling this. No prompt or implicit acceptance.
  await run('restic', ['-o', 'sftp.args=-oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=15', 'backup', '--tag', 'tradeledger-postgres', path, `${path}.json`], { env })
  process.stdout.write('Encrypted off-host backup complete.\n')
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv.length !== 2) throw safeError('Usage: node scripts/prod-backup.mjs')
    const path = await backup(await context())
    await offhostBackup(path)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
