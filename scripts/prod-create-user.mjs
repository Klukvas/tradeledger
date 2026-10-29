import process from 'node:process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export async function createUser(input) {
  if (process.env.NODE_ENV !== 'production') throw new Error('User creation requires NODE_ENV=production')
  const require = createRequire(new URL('../server/package.json', import.meta.url))
  require('reflect-metadata')
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../server/dist/server/src/app.module.js')
  const { AuthService, parseCredentials } = require('../server/dist/server/src/auth/auth.service.js')
  const credentials = parseCredentials(JSON.parse(input))
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false })
  try {
    const auth = app.get(AuthService)
    const issued = await auth.register(credentials)
    await auth.logout(issued.token)
    process.stdout.write('Account created; temporary session revoked.\n')
  } finally { await app.close() }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv.length !== 2 || process.stdin.isTTY) throw new Error('Supply JSON credentials on stdin')
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (input.length > 4096) throw new Error('Credential input too large')
    }
    await createUser(input)
  } catch {
    process.stderr.write('Account creation failed; check input, database availability and whether the account already exists.\n')
    process.exitCode = 1
  }
}
