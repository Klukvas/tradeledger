import process from 'node:process'
import { createRequire } from 'node:module'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { connect, createServer as createSocketServer } from 'node:net'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const socketPath = resolve('.cache/e2e-runtime.sock')
await mkdir('.cache', { recursive: true })
// Interrupted Playwright can leave its socket inode behind. Never remove a live,
// foreign-owned or non-socket path, and recheck the inode before unlinking it.
try {
  const previous = await lstat(socketPath)
  if (!previous.isSocket() || previous.uid !== process.getuid?.()) throw new Error('Test control path is not an owned socket')
  await new Promise((resolveStale, reject) => {
    const probe = connect(socketPath)
    probe.setTimeout(1_000, () => { probe.destroy(); reject(new Error('Cannot verify stale test socket')) })
    probe.once('connect', () => { probe.destroy(); reject(new Error('Another E2E runtime is active')) })
    probe.once('error', error => error.code === 'ECONNREFUSED' ? resolveStale() : reject(error))
  })
  const current = await lstat(socketPath)
  if (previous.ino !== current.ino || !current.isSocket()) throw new Error('Test control socket changed')
  await unlink(socketPath)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

// This process belongs exclusively to Playwright; no shared development listener is reused.
const { startHarness } = await import('../server/test/integration/harness.ts')
const origin = 'http://127.0.0.1:5179'
let harness = await startHarness({ origin })
await harness.app.listen(5181, '127.0.0.1')
process.env.API_PROXY_TARGET = 'http://127.0.0.1:5181'
const frontend = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: true } })
const compiled = createRequire(resolve('server/package.json'))
const { kyivMonth, monthBoundary, monthKey, shiftMonth } = compiled('./dist/src/domain/month-calendar.js')
const { closeDueMonths } = compiled('./dist/server/src/database/close-months.js')
let restarting = false
const control = createSocketServer(socket => {
  let input = ''
  socket.on('data', chunk => {
    input += chunk.toString()
    if (input.length > 1024) { socket.destroy(); return }
    if (!input.endsWith('\n')) return
    void (async () => {
      try {
        const message = JSON.parse(input)
        if (message.action === 'restart' && !restarting) {
          restarting = true
          const databaseName = harness.databaseName
          await harness.close()
          harness = await startHarness({ origin, reuseDatabaseName: databaseName })
          await harness.app.listen(5181, '127.0.0.1')
          restarting = false
          socket.end(JSON.stringify({ ok: true, databaseName }) + '\n')
        } else if (message.action === 'monthlyFixture' && /^e2e-[a-f0-9-]+@example\.test$/.test(message.email)) {
          // This OS-local control exists only in the isolated retained E2E database.
          // Backdate synthetic history once, then run the real production close engine.
          if (!/^tradeledger_it_[a-z0-9_]+$/.test(harness.databaseName)) throw new Error('Unsafe fixture database')
          const actor = await harness.database.user.findUniqueOrThrow({ where: { email: message.email }, select: { id: true } })
          const boundary = monthBoundary(kyivMonth(new Date()))
          const closedMonth = monthKey(shiftMonth(kyivMonth(boundary), -1))
          await harness.repository.withLockedWorkspace(actor.id, async (tx, workspace) => {
            const present = await tx.snapshot.findUnique({ where: { datasetId_closedMonth: { datasetId: workspace.activeDatasetId, closedMonth } } })
            if (!present) {
              const floor = new Date(boundary.getTime() - 86_400_000)
              await tx.dataset.update({ where: { id: workspace.activeDatasetId }, data: { accountHistoryStartedAt: floor } })
              await tx.accountHistory.updateMany({ where: { datasetId: workspace.activeDatasetId }, data: { effectiveAt: floor } })
            }
            const count = await closeDueMonths(tx, workspace, boundary)
            if (count) await tx.workspace.update({ where: { id: workspace.id }, data: { revision: workspace.revision + 1n, updatedAt: new Date() } })
          })
          socket.end(JSON.stringify({ ok: true, closedMonth, createdAt: boundary.toISOString() }) + '\n')
        } else if (message.action === 'counts' && /^e2e-[a-f0-9-]+@example\.test$/.test(message.email)) {
          const result = await harness.sql.query(`SELECT
            (SELECT count(*)::int FROM "Account" a WHERE a."datasetId" = w."activeDatasetId") AS accounts,
            (SELECT count(*)::int FROM "InventoryItem" i WHERE i."datasetId" = w."activeDatasetId") AS inventory,
            (SELECT count(*)::int FROM "CommandReceipt" r WHERE r."workspaceId" = w.id AND r."requestKind" = 'legacy') AS receipts,
            (SELECT count(*)::int FROM "Dataset" d WHERE d."workspaceId" = w.id AND d."archivedAt" IS NOT NULL) AS archives
            FROM "Workspace" w JOIN "User" u ON u.id = w."userId" WHERE u.email = $1`, [message.email])
          socket.end(JSON.stringify({ ok: true, value: result.rows[0] }) + '\n')
        } else socket.end(JSON.stringify({ ok: false, error: 'Unsupported test control' }) + '\n')
      } catch {
        restarting = false
        socket.end(JSON.stringify({ ok: false, error: 'Isolated runtime control failed' }) + '\n')
      }
    })()
  })
})
// OS-local test control, never an HTTP route or shipped application module.
await new Promise((resolveReady, reject) => {
  control.once('error', reject)
  control.listen(socketPath, resolveReady)
})
await chmod(socketPath, 0o600)
await frontend.listen()
process.stdout.write('[e2e] Isolated real PostgreSQL API 5181 and browser origin 5179 ready.\n')
let closing = false
async function close() {
  if (closing) return
  closing = true
  await frontend.close()
  await new Promise(resolveClosed => control.close(resolveClosed))
  await harness.close()
  process.exit(0)
}
process.on('SIGINT', () => { void close() })
process.on('SIGTERM', () => { void close() })
