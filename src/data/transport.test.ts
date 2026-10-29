import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTransport } from './transport'
afterEach(() => { vi.useRealTimers() })
describe('bounded same-origin JSON transport', () => {
  it.each([401, 403, 409, 429, 503])('maps HTTP %i to safe Russian messages', async (status) => {
    const transport = createTransport(async () => new Response(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: 'SQL password internal' } }), { status }))
    const response = await transport('/ledger')
    expect(response.status).toBe(status)
    expect(response.result.ok).toBe(false)
    expect(JSON.stringify(response)).not.toContain('SQL')
  })
  it('rejects HTML and unknown errors without displaying internal response text', async () => {
    const html = createTransport(async () => new Response('<html>private diagnostics</html>', { status: 502 }))
    const unknown = createTransport(async () => new Response(JSON.stringify({ ok: false, error: { code: 'UNKNOWN', message: 'private diagnostics' } }), { status: 500 }))
    expect(JSON.stringify(await html('/ledger'))).not.toContain('private')
    expect(JSON.stringify(await unknown('/ledger'))).not.toContain('private')
    expect((await html('/ledger')).result.ok).toBe(false)
  })
  it('aborts a hung request and does not automatically retry a mutation', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const fetcher = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      signal = init?.signal
      return new Promise(() => undefined)
    })
    const pending = createTransport(fetcher, 100)('/ledger/commands', { command: 'example' })
    await vi.advanceTimersByTimeAsync(101)
    expect((await pending).result.ok).toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
