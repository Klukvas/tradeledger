import process from 'node:process'
import { credentials, databaseUrl, run } from './db-env.mjs'

try {
  const args = process.argv.slice(2)
  const admin = args[0] === '--admin'
  const offset = admin ? 1 : 0
  if (args[offset] !== '--' || !args[offset + 1]) {
    throw new Error('Usage: node scripts/with-local-db.mjs [--admin] -- <command> [args...]')
  }
  const keys = await credentials()
  const url = databaseUrl(admin ? keys.admin : keys.app, { admin })
  const result = await run(args[offset + 1], args.slice(offset + 2), {
    env: { ...process.env, DATABASE_URL: url }, secrets: [keys.admin, keys.app, url], allowFailure: true, inheritInput: true,
  })
  process.exitCode = result.code ?? 1
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Database command failed'}\n`)
  process.exitCode = 1
}
