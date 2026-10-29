import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'

const require = createRequire(import.meta.url)
const { applyCommand } = require('../server/dist/src/domain/commands.js')
const { validateDocument } = require('../server/dist/src/domain/schema.js')

export const DEMO_EMAIL = 'tradeledger-demo-v1@example.invalid'
export const DEMO_ORIGIN = 'http://127.0.0.1:5178'
const prefix = 'demo-v1-'
const start = Date.parse('2026-10-01T09:00:00.000Z')
const emptyState = { inventory: [], accounts: [], debts: [], snapshots: [], audit: [] }
const products = [
  ['CBL-C100', 'Кабель USB-C 100 Вт, 1 м', 42, 13550],
  ['CBL-LGT', 'Кабель Lightning, 1 м', 18, 15990],
  ['CHG-20W', 'Зарядное устройство PD 20 Вт', 25, 24500],
  ['CHG-65W', 'Зарядное устройство GaN 65 Вт', 9, 69900],
  ['PWB-10K', 'Повербанк 10 000 мА·ч', 14, 48750],
  ['PWB-20K', 'Повербанк 20 000 мА·ч', 3, 86500],
  ['EAR-TWS', 'Беспроводные наушники TWS', 11, 62500],
  ['SPK-MINI', 'Портативная колонка Mini', 7, 41230],
  ['HUB-C7', 'USB-C хаб, 7 портов', 6, 75900],
  ['CASE-IP15', 'Чехол для iPhone 15', 35, 8900],
  ['GLASS-IP15', 'Защитное стекло iPhone 15', 64, 4250],
  ['HOLD-AUTO', 'Автодержатель магнитный', 21, 17900],
  ['SSD-1TB', 'Внешний SSD 1 ТБ', 2, 239900],
  ['MIC-USB', 'USB микрофон для звонков', 1, 119950],
  ['WATCH-STR', 'Ремешок для часов, 22 мм', 0, 6750],
  ['BAG-TECH', 'Органайзер для аксессуаров', 12, 12900],
]
const accounts = [
  ['mono-olena', 'MONO · основной', 'ФОП Коваль Олена (демо)', 'MONO', 12543050],
  ['mono-andrii', 'MONO · закупки', 'ФОП Мельник Андрій (демо)', 'MONO', 4820150],
  ['nova-olena', 'NovaPay · наложенные платежи', 'ФОП Коваль Олена (демо)', 'NovaPay', 1786425],
  ['nova-andrii', 'NovaPay · резерв', 'ФОП Мельник Андрій (демо)', 'NovaPay', 325000],
  ['mono-reserve', 'MONO · корректировки', 'ФОП Коваль Олена (демо)', 'MONO', -125050],
]
const debts = [
  ['supplier', 'payable', 'ТОВ «Аксесуар Плюс» (демо)', 3250000, 'Партия зарядных устройств; ручной учёт расчётов.', 1000000],
  ['delivery', 'payable', 'Логистика «Вектор» (демо)', 285075, 'Доставка партии за октябрь.', 0],
  ['loan', 'payable', 'Ірина Бондар (демо)', 800000, 'Возврат личного займа завершён.', 800000],
  ['retail', 'receivable', 'Магазин «Точка» (демо)', 1875000, 'Отсрочка по партии аксессуаров.', 625000],
  ['customer', 'receivable', 'Дмитро Савчук (демо)', 145050, 'Остаток оплаты заказа.', 0],
  ['partner', 'receivable', 'Оксана Левченко (демо)', 450000, 'Расчёт завершён полностью.', 450000],
]

/** Fixed dates/IDs and integer kopecks make the demonstration reproducible. */
export function demoCommands() {
  const inventory = products.map(([sku, name, quantity, unitCostMinor], index) => ({
    type: 'inventory.create', id: `${prefix}item-${index + 1}`, sku, name, quantity, unitCostMinor,
  }))
  const openingAccounts = accounts.map(([key, name, owner, provider, balanceMinor]) => ({
    type: 'account.create', id: `${prefix}${key}`, name, owner, provider, balanceMinor,
  }))
  const borrowing = debts.flatMap(([key, direction, counterparty, principalMinor, note, amountMinor]) => [
    { type: 'debt.create', id: `${prefix}debt-${key}`, direction, counterparty, principalMinor, note },
    ...(amountMinor ? [{ type: 'debt.repay', id: `${prefix}debt-${key}`, amountMinor }] : []),
  ])
  const history = Array.from({ length: 10 }, (_, day) => [
    ...accounts.map(([key, , , , opening], index) => ({
      seedAt: new Date(Date.parse('2026-10-03T09:00:00.000Z') + day * 172800000 + index * 60000).toISOString(),
      type: 'account.setBalance', id: `${prefix}${key}`,
      balanceMinor: opening + (index === 4 ? -1 : 1) * (day * 17345 + ((day * 3 + index) % 4) * 23525),
    })),
    { seedAt: new Date(Date.parse('2026-10-03T09:05:00.000Z') + day * 172800000).toISOString(), type: 'snapshot.create', id: `${prefix}snapshot-${day + 1}`, label: `Сверка ${String(3 + day * 2).padStart(2, '0')}.10 · демо` },
  ]).flat()
  const movements = [
    { type: 'inventory.receive', id: `${prefix}item-1`, quantity: 20, unitCostMinor: 14200 },
    { type: 'inventory.issue', id: `${prefix}item-1`, quantity: 8, reason: 'Отгрузка по заказам (демо), без расчёта прибыли' },
    { type: 'inventory.issue', id: `${prefix}item-14`, quantity: 1, reason: 'Отгрузка последнего экземпляра (демо)' },
    { type: 'account.setBalance', id: `${prefix}mono-olena`, balanceMinor: 14875635 },
  ]
  return [...inventory, ...openingAccounts, ...borrowing, ...history, ...movements].map(({seedAt, ...command}, index) => ({
    ...command, meta: {
      commandId: `${prefix}command-${String(index + 1).padStart(3, '0')}`,
      at: seedAt ?? new Date(start + (index < 31 ? index * 60000 : 23 * 86400000 + index * 60000)).toISOString(),
    },
  }))
}

export function demoStates(commands = demoCommands()) {
  return commands.reduce((states, command) => {
    const result = applyCommand(states.at(-1), command)
    if (!result.ok) throw new Error(`Invalid demo command: ${result.error.code}`)
    return [...states, result.value]
  }, [emptyState])
}

export function demoDocument() {
  const commands = demoCommands()
  const document = { schemaVersion: 1, revision: commands.length,
    updatedAt: commands.at(-1).meta.at, state: demoStates(commands).at(-1) }
  const checked = validateDocument(document)
  if (!checked.ok) throw new Error(`Invalid demo document: ${checked.error.code}`)
  return checked.value
}

/** The only write allowed is one atomic import into a pristine dedicated account. */
export function seedPosition(document, expected = demoDocument()) {
  const checked = validateDocument(document)
  if (checked.ok && document.revision === 0 && isDeepStrictEqual(document.state, emptyState)) return 'empty'
  if (checked.ok && document.revision === 1 && isDeepStrictEqual(document.state, expected.state)) return 'seeded'
  throw new Error('Demo ledger differs from the seed; preserving all records. Use the dedicated demo account with its original seed credentials.')
}

export function assertDemoTarget(origin, email) {
  if (origin !== DEMO_ORIGIN || email !== DEMO_EMAIL) {
    throw new Error(`Demo seed is restricted to ${DEMO_ORIGIN} and ${DEMO_EMAIL}.`)
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed cannot run in production.')
}
