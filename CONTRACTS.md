# TradeLedger — доменный контракт

Этот документ описывает данные и бизнес-правила учёта. Источник статических типов — [src/domain/types.ts](./src/domain/types.ts); HTTP, авторизация и детали PostgreSQL описаны в [API_CONTRACTS.md](./API_CONTRACTS.md), карта модулей — в [ARCHITECTURE.md](./ARCHITECTURE.md).

## Данные и деньги

- Только UAH. `Money = number`: безопасное целое число копеек. Вся арифметика умножения, суммирования и пропорций проверяет диапазон через BigInt до перевода в number.
- `InventoryItem`: id, sku, name, quantity (целое ≥ 0), stockValueMinor (целое ≥ 0). Стоимость создания/прихода = количество × закупочная цена. Расход списывает пропорцию стоимости с округлением половины вверх; последний расход оставляет нулевую стоимость. SKU уникален после trim и приведения регистра.
- `Account`: id, name, owner, provider (`MONO`, `NovaPay`, `other`), balanceMinor. Отрицательный баланс разрешён.
- `Debt`: id, direction (`payable`, `receivable`), counterparty, principalMinor > 0, repaidMinor от 0 до principalMinor, note. Погашение не меняет банковские балансы.
- `Snapshot`: id, createdAt (ISO), label, accounts (копии accountId/name/owner/provider/balanceMinor), totalMinor. Сохранённая фиксация балансов неизменяема. Необязательное `closedMonth: "YYYY-MM"` обозначает явное закрытие месяца: createdAt строго равен следующей границе месяца в Europe/Kyiv; один closedMonth на dataset. У прежних ручных фиксаций балансов поле отсутствует.
- `AuditEvent`: id, at (ISO), type, entityId, summary. Для обычной команды id **равен command.meta.commandId**, type — тип команды; отдельного поля commandId нет. Автоматическое закрытие создаёт собственный audit id и использует `type: "snapshot.create"` для совместимости истории, без пользовательской команды.
- `LedgerState`: readonly массивы inventory/accounts/debts/snapshots/audit. `DocumentV1`: schemaVersion: 1, revision (безопасное целое ≥ 0), updatedAt (ISO), state.
- Любое сохранённое число, итог раздела и итог фиксации балансов должны быть безопасными целыми. Команды/импорт отклоняют переполнение хранимых сумм. Производная разница между безопасными итогами может выйти за диапазон: месячный selector возвращает ошибку Result, UI показывает её явно; сама запись/копия остаётся допустимой. quantity и revision также безопасные целые.
- Старт пустой, без демоданных. Данные аккаунта хранятся в PostgreSQL; банковских интеграций нет.

## Команды и домен

`applyCommand(state: LedgerState, command: Command): Result<LedgerState>` — чистая immutable-функция; атомарно возвращает новое состояние вместе с audit. `validateDocument(input: unknown): Result<DocumentV1>` проверяет полную структуру, инварианты и агрегаты; неизвестная версия возвращает `UNSUPPORTED_VERSION`. Пользовательские строки обрезаются по краям в командах.

Каждая команда содержит верхнеуровневые поля и `meta: {commandId, at}`; полей payload/data нет:

| type | поля кроме meta/type |
|---|---|
| inventory.create | id, sku, name, quantity, unitCostMinor |
| inventory.update | id, sku, name |
| inventory.receive | id, quantity, unitCostMinor |
| inventory.issue | id, quantity, reason |
| account.create | все поля Account |
| account.update | id, name, owner, provider |
| account.setBalance | id, balanceMinor |
| debt.create | id, direction, counterparty, principalMinor, note |
| debt.update | id, counterparty, principalMinor, note |
| debt.repay | id, amountMinor |
| snapshot.create | id, label; только прежний доменный формат/история, HTTP-команды создания отклоняются |

Удаления нет. Изменение долга не может сделать principalMinor меньше погашенного. Дубликат commandId обрабатывается идемпотентно, без повторного события.

Selectors из `src/domain/selectors.ts`:

- `getAccountsTotal(state): number`
- `getStockTotal(state): number`
- `getDebtTotals(state): {payable: number, receivable: number}` — остатки долгов
- `getMoneyChange(state): number | null` — текущая сумма счетов минус последнюю фиксацию балансов; без фиксаций null. Прежний selector для совместимости, в UI не используется. UI использует `getMonthlyMoneyChange(state, asOf)` из monthly-money.ts: текущие счета минус Snapshot с closedMonth прошлого месяца, иначе null. Переполнение возвращается как Result. Это не прибыль.

Деньги из `src/domain/money.ts`: `parseMoney(input: string, allowNegative = false): Result<number>`, `formatMoney(minor: number): string`. Парсер принимает цифры, точку/запятую и до двух знаков после разделителя; внешние пробелы допускаются, группировка и экспоненты запрещены. `checkedMoney(value: bigint): Result<number>` — проверяемое преобразование для арифметики домена. Ошибка парсинга/диапазона: VALIDATION. Форматтер использует ru-RU/UAH и требует безопасное целое.

## Серверное хранилище и миграция

Сервер — источник учёта; `DocumentV1` представляет данные для API и резервных копий, а PostgreSQL хранит нормализованные записи. Пользователь владеет workspace, активным dataset, архивами и квитанциями. Исторические импортированные остатки имеют отдельное происхождение, а не выдуманную историю движений. HTTP-типы находятся в [shared/api.ts](./shared/api.ts); блокировки, транзакции, схема и безопасность — в [серверном контракте](./API_CONTRACTS.md#persistence-and-module-boundaries).

`src/data/index.ts` экспортирует `useLedger`, `useAuth`, `createCommandMeta`, `createId`. Singleton hook не требует provider. `snapshot` различает loading/ready/blocked; `dispatch(command, expectedRevision)` и `importBackup(json, expectedRevision)` асинхронно возвращают `Result<DocumentV1>`, `exportBackup()` — синхронный `Result<string>` из текущего snapshot; UI использует `exportServerBackup()` — `Promise<Result<string>>` с защищённым HTTP-чтением, `refresh()` — `Promise<void>`. Ошибки сети сохраняют черновик; 401 очищает учёт и возвращает вход. В защищённые запросы клиент передаёт захваченный id пользователя `X-TradeLedger-User`, сервер сверяет его с cookie; заголовок не предоставляет полномочий. Устаревшая вкладка не получает доступ к данным нового аккаунта в cookie.

Команда проверяет expectedRevision и идемпотентность в одной транзакции. Тот же commandId с тем же payload воспроизводит подтверждение без повторной истории; изменённый payload отклоняется. Импорт создаёт новый нормализованный dataset, архивирует прежний и увеличивает общую ревизию. Квитанция содержит requestId, datasetId, sourceHash, counts, committedRevision. Повтор того же запроса до проверки CAS возвращает текущий документ, сохранённую квитанцию и `replayed: true`; документ не замораживается на момент первого импорта. Архивы и квитанции другого пользователя недоступны.

IndexedDB `tradeledger` используется только как прежний источник: чтение без записи/удаления, предпросмотр, адрес назначения, явное согласие и дополнительное подтверждение полной замены непустого аккаунта. Успех требует повторного чтения и проверки серверной квитанции. Исходный документ остаётся неизменным. Повреждённый/слишком большой источник не отправляется; сохраняется возможность получить исходную копию.

## UI и проверки

Все формы на русском, деньги UAH. UI хранит строковые поля до валидации; денежные поля преобразуются parseMoney, в команды передаются копейки. Команды используют revision от отображённого документа. На время busy блокируется повторное сохранение. Балансы и долги — независимые ручные записи.

[src/test/fixtures.ts](./src/test/fixtures.ts): createEmptyState, createDocument, FIXED_TIME; фабрики создают независимые значения. Команды проверок и условия их запуска описаны в [README](./README.md#проверки), состав HTTP/SQL-проверок — в [server/test/integration/README.md](./server/test/integration/README.md).

## Автоматическое закрытие месяцев

Официальное закрытие фиксирует состав и балансы счетов на границе календарного месяца по `Europe/Kyiv`. Расписание, повторы после ошибок и SQL-инварианты описаны в [API_CONTRACTS.md](./API_CONTRACTS.md#automatic-monthly-account-closes). `Dataset.accountHistoryStartedAt` — доверенная нижняя граница. Журнал `AccountHistory` хранит полный состав состояния каждого счёта (метаданные, баланс, позиция) с серверным effectiveAt и ревизией для одинаковых миллисекунд. При первом запуске текущие счета становятся исходной точкой с фактическим временем; импорт создаёт новую точку с фактическим временем, не с sourceUpdatedAt. Пустой доверенный состав допустим.

Все операции с журналом и закрытиями сериализованы тем же FOR UPDATE workspace, что команды и импорт. Время события — PostgreSQL clock_timestamp после получения блокировки, усечённое до миллисекунды; это время сериализованной операции, а не момент её физического COMMIT. Для границы B берётся последняя версия каждого счёта с effectiveAt < B; tie-breaker — большая revision. Счета, появившиеся в B или позднее, исключаются. Месяцы до начала истории недоступны, ручные/немаркированные snapshots не повышаются до официальных.

Перед импортом закрываются все доступные пропущенные месяцы прежнего dataset, затем он архивируется. CAS сравнивает исходную клиентскую ревизию. Если закрытие добавило записи, архив получает исходную ревизию + 1 и время операции, импорт — ещё + 1; при недостатке безопасных ревизий вся транзакция отклоняется. Без нового закрытия импорт увеличивает ревизию один раз. Официальные закрытия и прежняя история сохраняются в JSON; внутренний журнал не входит в JSON и после восстановления начинается заново.
