import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { context, run, validateCompose, assertDatabaseOwnership, waitDatabase, bootstrap, atomicJson, readState, safeError, withOperation } from './prod-common.mjs'
import { backup } from './prod-backup.mjs'

export async function buildRelease(ctx, release) {
  if (!/^[a-z0-9][a-z0-9-]{5,80}$/.test(release)) throw safeError('Invalid release identifier')
  for (const service of ['api', 'web']) {
    const image = `tradeledger-${service}:${release}`
    const existing = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { allowFailure: true })
    if (existing.code === 0) throw safeError('Release tag already exists; immutable tags cannot be overwritten')
    process.stdout.write(`Building ${service} release ${release}...\n`)
    await run('docker', ['build', '--file', `deploy/${service}.Dockerfile`, '--tag', image, '.'])
  }
}
export async function launch(ctx) {
  await ctx.compose(['up', '-d', '--no-deps', 'api', 'web'])
  await ctx.compose(['up', '-d', '--no-deps', 'caddy'])
  const deadline = Date.now() + 180_000
  let lastProgress = Date.now()
  while (Date.now() < deadline) {
    if (Date.now() - lastProgress > 30_000) { process.stdout.write('Waiting for release readiness and HTTPS...\n'); lastProgress = Date.now() }
    const ready = await ctx.compose(['exec', '-T', 'api', 'node', '-e', "fetch('http://127.0.0.1:5180/api/health/ready', {signal: AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], { allowFailure: true })
    const web = await ctx.compose(['exec', '-T', 'web', 'curl', '--fail', '--silent', '--max-time', '5', '--output', '/dev/null', 'http://127.0.0.1:8080/'], { allowFailure: true })
    if (ready.code === 0 && web.code === 0) {
      if (ctx.smoke) return
      const https = await run('curl', ['--fail', '--silent', '--show-error', '--max-time', '5', `${ctx.config.PUBLIC_ORIGIN}/api/health/ready`], { allowFailure: true })
      if (https.code === 0) return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  throw safeError('Release readiness timeout; previous release images/state preserved. Inspect before explicit code rollback')
}
export async function deploy(ctx, { build = true } = {}) {
  return withOperation(ctx, async () => {
    await validateCompose(ctx)
    await assertDatabaseOwnership(ctx)
    const previous = await readState(ctx)
    const release = ctx.env.TRADELEDGER_RELEASE
    if (build) await buildRelease(ctx, release)
    await ctx.compose(['up', '-d', '--no-recreate', 'db'])
    await waitDatabase(ctx)
    await bootstrap(ctx)
    // Full DB backup precedes EVERY migration, including the initial empty database.
    const savedBackup = await backup(ctx)
    await atomicJson(join(ctx.state, 'pending.json'), { release, previous, backup: savedBackup })
    await ctx.compose(['stop', 'api'])
    process.stdout.write('API paused for migration; previous release images and backup retained.\n')
    await ctx.compose(['run', '--rm', '--no-deps', 'migrate'])
    await launch(ctx)
    await atomicJson(join(ctx.state, 'release.json'), { current: release, previous: previous?.current ?? null, backup: savedBackup })
    process.stdout.write(`Release ${release} ready internally. Verify public HTTPS before opening access.\n`)
  })
}
async function main() {
  const action = process.argv[2]
  if (!['validate', 'deploy', 'status', 'stop', 'rollback', 'create-user'].includes(action)) throw safeError('Usage: node scripts/prod-stack.mjs validate|deploy|status|stop|rollback|create-user')
  const release = `release-${Date.now()}-${randomUUID().slice(0, 8)}`
  const ctx = await context({ release })
  const state = await readState(ctx)
  if (action === 'validate') return validateCompose(ctx)
  if (action === 'deploy') return deploy(ctx)
  if (action === 'status') return ctx.compose(['ps'], { quiet: false })
  if (action === 'stop') return withOperation(ctx, () => ctx.compose(['stop']))
  if (!state) throw safeError('No successful production release recorded')
  if (action === 'create-user') {
    let input = ''
    if (process.stdin.isTTY) throw safeError('Supply JSON credentials on stdin from a hidden prompt; see deploy/production.md')
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) throw safeError('Credential input too large') }
    const active = await context({ release: state.current })
    await withOperation(active, () => active.compose(['exec', '-T', 'api', 'node', 'scripts/prod-create-user.mjs'], { input }))
    process.stdout.write('Account created; temporary session revoked.\n')
  }
  if (action === 'rollback') {
    if (process.argv[3] !== '--schema-compatible') throw safeError('Rollback requires --schema-compatible after reviewing migrations; database is never downgraded/restored automatically')
    await withOperation(ctx, async () => {
      const latest = await readState(ctx)
      const pending = JSON.parse(await readFile(join(ctx.state, 'pending.json'), 'utf8'))
      const target = pending.release !== latest.current ? latest.current : latest.previous
      if (!target) throw safeError('No previous known-good release available')
      const rollback = await context({ release: target })
      for (const service of ['api', 'web']) await run('docker', ['image', 'inspect', '--format', '{{.Id}}', `tradeledger-${service}:${target}`])
      await launch(rollback)
      await atomicJson(join(ctx.state, 'release.json'), { ...latest, current: target, previous: latest.current === target ? latest.previous : latest.current })
      process.stdout.write(`Code rollback ready: ${target}; database unchanged.\n`)
    })
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
