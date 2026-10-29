import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../server/package.json', import.meta.url)))
const { Client } = require('pg')
const client = new Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO tradeledger_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tradeledger_app;
    REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM tradeledger_app;`)
  process.stdout.write('Application grants applied; migration metadata remains private.\n')
} catch {
  process.stderr.write('Could not apply application database grants.\n')
  process.exitCode = 1
} finally {
  await client.end()
}
