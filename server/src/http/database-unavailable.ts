const unavailableCodes = new Set([
  'P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037',
  'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND',
])
const unavailableAdapterKinds = new Set([
  'DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections', 'TlsConnectionError',
])

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

/** Never inspect messages: adapter errors can contain SQL and connection credentials. */
export function isDatabaseUnavailable(exception: unknown, depth = 0): boolean {
  const error = record(exception)
  if (!error || depth > 5) return false
  if (error.name === 'PrismaClientInitializationError' || error.name === 'DatabasePoolTimeoutError') return true
  if (typeof error.code === 'string' && unavailableCodes.has(error.code)) return true
  if (error.name === 'DriverAdapterError') {
    const cause = record(error.cause)
    if (typeof cause?.kind === 'string' && unavailableAdapterKinds.has(cause.kind)) return true
  }
  // Prisma wraps driver failures in meta.driverAdapterError, including P2010 raw-query errors.
  const adapterError = record(error.meta)?.driverAdapterError
  return isDatabaseUnavailable(adapterError, depth + 1) || isDatabaseUnavailable(error.cause, depth + 1)
}
