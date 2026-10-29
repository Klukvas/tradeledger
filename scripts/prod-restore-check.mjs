import process from 'node:process'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { context, sql, within, safeError, fileChecksum } from './prod-common.mjs'

export async function tableCounts(ctx, database) {
  const result = await sql(ctx, `SELECT format('SELECT %L || ''|'' || count(*)::text FROM %I.%I;', tablename, schemaname, tablename)
    FROM pg_tables WHERE schemaname='public' ORDER BY tablename\n\\gexec\n`, database)
  return result.output.trim().split('\n').filter(Boolean)
}
export async function restoreCheck(ctx, path) {
  const absolute = within(path, join(ctx.state, 'backups'))
  const manifest = JSON.parse(await readFile(`${absolute}.json`, 'utf8'))
  if (manifest.project !== ctx.project || manifest.sha256 !== await fileChecksum(absolute)) {
    throw safeError('Backup checksum or project mismatch; restore refused')
  }
  const database = `tradeledger_restore_${Date.now()}_${randomBytes(4).toString('hex')}`
  // A new database only. No --clean, DROP, overwrite, or automatic swap of the working DB.
  await sql(ctx, `CREATE DATABASE ${database} OWNER tradeledger_admin;`, 'postgres')
  await ctx.compose(['exec', '-T', 'db', 'pg_restore', '-U', 'tradeledger_admin', '-d', database, '--exit-on-error', '--no-owner', '--no-acl'], { input: createReadStream(absolute) })
  const counts = await tableCounts(ctx, database)
  if (!counts.some(line => line.startsWith('User|')) || !counts.some(line => line.startsWith('Workspace|'))) throw safeError('Restored archive lacks account/workspace tables')
  process.stdout.write(`Restore verified in NEW database ${database}; working database unchanged.\n${counts.join('\n')}\n`)
  return { database, counts }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv.length !== 3) throw safeError('Usage: node scripts/prod-restore-check.mjs .production-state/tradeledger-prod/backups/FILE.dump')
    await restoreCheck(await context(), process.argv[2])
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
