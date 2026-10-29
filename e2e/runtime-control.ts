import { connect } from 'node:net'
import { resolve } from 'node:path'

export type SqlCounts = Readonly<{ accounts: number; inventory: number; receipts: number; archives: number }>
export async function runtimeControl(message: Readonly<{ action: 'restart' } | { action: 'counts' | 'monthlyFixture'; email: string }>): Promise<Readonly<{ ok: boolean; value?: SqlCounts; databaseName?: string; closedMonth?: string; createdAt?: string }>> {
  return new Promise((resolveResult, reject) => {
    const socket = connect(resolve('.cache/e2e-runtime.sock'))
    let response = ''
    socket.setTimeout(20_000, () => { socket.destroy(); reject(new Error('Isolated runtime control timed out')) })
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'))
    socket.on('data', chunk => { response += chunk.toString() })
    socket.on('end', () => {
      try { resolveResult(JSON.parse(response) as Awaited<ReturnType<typeof runtimeControl>>) }
      catch { reject(new Error('Invalid isolated runtime response')) }
    })
    socket.on('error', reject)
  })
}
