# TradeLedger — архитектура

TradeLedger — React-приложение с NestJS API и PostgreSQL. Эта карта описывает текущие модули; правила данных находятся в [доменном контракте](./CONTRACTS.md), HTTP и хранение — в [серверном контракте](./API_CONTRACTS.md), запуск — в [README](./README.md).

## Клиент

- [src/main.tsx](./src/main.tsx) монтирует React и границу ошибок. [src/App.tsx](./src/App.tsx) выбирает экран авторизации или учёта, обрабатывает hash-маршруты и состояния загрузки/ошибки.
- [src/pages](./src/pages) содержит обзор, склад, счета, долги, историю и резервные копии. Пять основных разделов доступны в меню; резервные копии открываются отдельно по `/#settings`.
- [src/ui](./src/ui) содержит общие компоненты без зависимостей от домена и хранилища; их возможности описаны в [локальном README](./src/ui/README.md). Общие стили оболочки находятся в [src/styles.css](./src/styles.css).
- [src/data/index.ts](./src/data/index.ts) связывает singleton-хранилища с React через `useAuth` и `useLedger`. [store.ts](./src/data/store.ts) хранит клиентский snapshot и координирует обновления, [auth.ts](./src/data/auth.ts) — состояние сессии, [transport.ts](./src/data/transport.ts) — HTTP и привязку запроса к ожидаемому пользователю.
- [AuthScreen.tsx](./src/auth/AuthScreen.tsx) показывает только вход. [SettingsPage.tsx](./src/pages/SettingsPage.tsx) и [LegacyTransfer.tsx](./src/pages/settings/LegacyTransfer.tsx) дают экспорт, предпросмотр восстановления и явный перенос прежних данных.

PostgreSQL — источник учёта; клиентский snapshot служит текущим представлением ответа сервера. Автономной очереди записей нет. [legacy.ts](./src/data/legacy.ts) читает прежнюю IndexedDB без изменения источника. `localStorage` в оболочке хранит предпочтение свёрнутого меню, а не данные учёта.

## Общий домен и транспорт

[src/domain/types.ts](./src/domain/types.ts) задаёт данные и команды, [commands.ts](./src/domain/commands.ts) применяет чистые изменения, [money.ts](./src/domain/money.ts) выполняет точную денежную арифметику, [schema.ts](./src/domain/schema.ts) проверяет документы. Этот же домен импортируется сервером. [shared/api.ts](./shared/api.ts) задаёт HTTP-типы, [shared/canonical.ts](./shared/canonical.ts) — каноническое представление для хешей запросов.

## Сервер и путь команды

[server/src/main.ts](./server/src/main.ts) создаёт Nest-приложение из [AppModule](./server/src/app.module.ts). [configure-http.ts](./server/src/http/configure-http.ts) настраивает HTTP-границы и обработку ошибок. [SessionGuard](./server/src/auth/session.guard.ts) проверяет сессию и ожидаемого пользователя; подробности авторизации — в [server/src/auth/README.md](./server/src/auth/README.md).

Обычное сохранение проходит через следующие части:

1. Страница передаёт команду и отображённую ревизию в клиентское хранилище; transport отправляет запрос API.
2. [LedgerController](./server/src/ledger/ledger.controller.ts) передаёт команду в [MutationService](./server/src/mutations/mutation.service.ts).
3. [LedgerRepository](./server/src/database/ledger.repository.ts) открывает транзакцию и блокирует workspace владельца через `FOR UPDATE`. MutationService проверяет квитанцию повтора и CAS, получает серверное время и вызывает общий домен.
4. [persist-command.ts](./server/src/database/persist-command.ts) сохраняет изменённые нормализованные записи, историю и audit. Ревизия и квитанция команды фиксируются в той же транзакции; клиент получает документ для обновления snapshot.

Чтения и экспорт проходят через LedgerController и LedgerRepository. [ImportService](./server/src/ledger/import.service.ts) в одной блокируемой транзакции закрывает доступные пропущенные месяцы прежнего набора, архивирует его и активирует новый dataset с квитанцией. [ArchiveService](./server/src/ledger/archive.service.ts) читает архивы владельца с сохранёнными метаданными документа. Схема записей — [server/prisma/schema.prisma](./server/prisma/schema.prisma), изменения схемы — [server/prisma/migrations](./server/prisma/migrations).

## Месячные закрытия

[MonthlyCloseService](./server/src/monthly-close/monthly-close.service.ts) запускает закрытие по Киеву и восстановление пропущенных границ при старте. [account-history.ts](./server/src/database/account-history.ts) хранит полные версии счетов и серверное время операции; [close-months.ts](./server/src/database/close-months.ts) строит официальные фиксации на границах месяцев. Клиентские [monthly-money.ts](./src/domain/monthly-money.ts) и [useMonthlyMoney.ts](./src/pages/shared/useMonthlyMoney.ts) выбирают прошлый официальный месяц и обновляют отображение. Точные правила границ, покрытия истории и повторов описаны в [контрактах](./API_CONTRACTS.md#automatic-monthly-account-closes).

## Проверки и эксплуатация

Домен и клиент проверяются тестами рядом с исходниками; HTTP/SQL-сценарии находятся в [server/test/integration](./server/test/integration/README.md), браузерные — в [e2e](./e2e). Команды и требования перечислены в [README](./README.md#проверки). Локальный стек запускает [local-stack.mjs](./scripts/local-stack.mjs); production-процедуры описаны в [deploy/production.md](./deploy/production.md), включая ограничение отката к старому API, который не ведёт журнал полных состояний счетов.
