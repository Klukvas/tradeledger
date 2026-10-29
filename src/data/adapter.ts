/** Legacy IndexedDB constants only. Production persistence is exclusively the server API.
 * Existing browser data may be inspected through readLegacyLedger; no write adapter is exposed.
 */
export const DATABASE_NAME = 'tradeledger'
export const OBJECT_STORE = 'ledger'
export const DOCUMENT_KEY = 'document'
