import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { bootstrap, composeEnvironment, credentials, run } from './db-env.mjs'

try {
  const action = process.argv[2] ?? 'up'
  if (!['db', 'api', 'up', 'status', 'stop'].includes(action)) throw new Error('Usage: node scripts/local-stack.mjs [db|api|up|status|stop]')
  const keys = await credentials({ create: ['db', 'api', 'up'].includes(action) })
  const options = { env: composeEnvironment(keys), secrets: [keys.admin, keys.app] }
  if (action === 'status' || action === 'stop') {
    await run('docker', ['compose', action === 'status' ? 'ps' : 'stop'], options)
  } else {
    await run('docker', ['compose', 'up', '-d', 'db'], options)
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await run('docker', ['exec', 'tradeledger-db', 'pg_isready', '-U', 'tradeledger_admin', '-d', 'tradeledger'], { ...options, quiet: true, allowFailure: true })
      if (result.code === 0) { ready = true; break }
      await setTimeout(1000)
    }
    if (!ready) throw new Error('PostgreSQL did not become ready within 60 seconds; data preserved')
    await bootstrap(keys)
    process.stdout.write('Database ready at 127.0.0.1:5439; application and migration roles configured.\n')
    if (action === 'api' || action === 'up') {
      const services = action === 'api' ? ['api'] : ['api', 'web']
      await run('docker', ['compose', 'up', '-d', '--build', '--wait', ...services], options)
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Local stack failed'}\n`)
  process.exitCode = 1
}
