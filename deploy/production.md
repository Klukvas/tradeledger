# Один production VPS: ручной запуск и обновления

Подготовленный контур не подключается к Hetzner и не создаёт сервер. CI/CD нет. Нужны Linux VPS, Docker Engine с Compose v2, Node.js **24.15+ ветки 24**, `curl`, Python 3, SSH-ключ и домен либо закреплённый публичный IPv4. Для сборки на сервере практично иметь 4 ГБ RAM и запас диска под два выпуска и резервные копии. Проверьте HTTPS перед передачей доступа. Пользователь с доступом к Docker фактически имеет административный доступ к хосту.

## Сеть и файлы

Назначьте DNS A на IPv4 сервера; AAAA добавляйте только при настроенном IPv6. Разрешите входящий SSH только со своего адреса, TCP 80/443 для сайта. Caddy выпускает публичный сертификат сам; DNS должен уже указывать на сервер и порты должны быть доступны. Cloudflare proxy пока отключите: схема рассчитана на один непосредственно доступный Caddy, `TRUST_PROXY_HOPS=1`. API 5180, PostgreSQL 5432 и nginx 8080 не имеют host ports.

Временно можно работать без домена: `PUBLIC_ORIGIN=https://ПУБЛИЧНЫЙ_IPV4` и `PUBLIC_TLS_MODE=ip`. Скрипт выбирает [Caddyfile.ip](./Caddyfile.ip): публичный сертификат Let’s Encrypt с профилем `shortlived`, автоматическим продлением и `default_sni` для браузеров без IP SNI. Сертификат действителен 160 часов; Caddy и его persistent volume должны постоянно работать, а порты 80/443 оставаться доступными для продления. DNS в этом режиме не нужен. Приватные, loopback, служебные и IPv6 адреса этот комплект не принимает. Самоподписанного сертификата и отключения проверки TLS нет. Обычный доменный режим остаётся по умолчанию (`PUBLIC_TLS_MODE=domain` или пусто); для перехода на домен отдельно запланируйте смену origin и новый выпуск.

Используйте постоянный каталог `/srv/tradeledger`, принадлежащий пользователю `tradeledger`; Docker и Node установите по официальным инструкциям. Копируйте исходники и lockfile в этот каталог **без удаления** существующих файлов:

```sh
rsync -av --exclude node_modules/ --exclude .cache/ --exclude .production-state/ --exclude '.env*' ./ tradeledger@SERVER:/srv/tradeledger/
```

Это команда для последующего ручного запуска с вашей машины, а не выполненная публикация. Подставьте адрес сервера. Не переносите локальные volumes, демо-учётки и `.env`. Одинаковый путь нужен при каждом обновлении. `.production-state/` хранит журнал успешного/предыдущего выпуска, незавершённую попытку и DB-копии; его нельзя заменять новым исходным архивом, удалять или исключать из серверного резервирования. Именованные volumes `tradeledger-prod_database`, `tradeledger-prod_caddy_data`, `tradeledger-prod_caddy_config` сохраняют данные и сертификаты независимо от контейнеров.

## Первое заполнение конфигурации — только на сервере

Все значения в `.env.production.example` пусты. Следующая команда создаёт новый защищённый `.env.production`, спросит публичный HTTPS origin и сгенерирует **разные** DB-пароли в памяти. Она не печатает пароли и откажется перезаписывать существующий файл. Запускайте только в `/srv/tradeledger` на сервере:

```sh
python3 - <<'PY'
import os, secrets
import sys
print('PUBLIC_ORIGIN (https://your-domain): ', end='', file=sys.stderr, flush=True)
with open('/dev/tty') as tty:
    origin = tty.readline().strip()
    print('PUBLIC_TLS_MODE (domain or ip): ', end='', file=sys.stderr, flush=True)
    tls_mode = tty.readline().strip() or 'domain'
content = 'PUBLIC_ORIGIN=' + origin + '\n'
content += 'PUBLIC_TLS_MODE=' + tls_mode + '\n'
content += 'TRADELEDGER_DB_ADMIN_PASSWORD=' + secrets.token_hex(32) + '\n'
content += 'TRADELEDGER_DB_APP_PASSWORD=' + secrets.token_hex(32) + '\n'
fd = os.open('.env.production', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write(content)
print('Production configuration created; credentials withheld.')
PY
node scripts/prod-stack.mjs validate
```

Origin строго вида `https://ledger.example.com` либо `https://ПУБЛИЧНЫЙ_IPV4` при `PUBLIC_TLS_MODE=ip`: без пути, завершающего `/` и нестандартного порта. Файл читается самим скриптом, без `source` и shell expansion. DB-пароли: 64 случайных hex-символа, разные. Храните защищённую копию конфигурации отдельно от сервера. Не меняйте эти пароли в файле после создания БД: скрипт не выполняет ротацию и не перезаписывает пароль существующей роли. При несовпадении проверка подключения остановит выпуск. Не запускайте `docker compose config` без `--quiet`: обычный вывод раскрывает переменные.

## Первый выпуск и доступ

```sh
node scripts/prod-stack.mjs deploy
node scripts/prod-stack.mjs status
```

Скрипт использует исключительно Compose project `tradeledger-prod` и `compose.production.yaml`. Он проверяет владельца/точное подключение DB-volume; собирает API и статический web в уникальные локальные теги; запускает БД; создаёт ограниченную роль `tradeledger_app` только при её отсутствии; проверяет оба DB-пароля; делает полный `pg_dump`; останавливает API на время миграции; выполняет Prisma migrations административной ролью и существующие post-migrate grants; запускает API/web/Caddy; проверяет внутреннюю готовность и публичный HTTPS с обычной проверкой сертификата. Выпуск считается успешным только после этих проверок. Ожидание ограничено. Первый ACME-выпуск сертификата может занять несколько минут.

Публичная регистрация в production всегда закрыта сервером; web собран с `VITE_PUBLIC_REGISTRATION=false`. Создайте аккаунт через локальный CLI на сервере; пароль вводится без отображения, JSON идёт только через pipe в stdin:

```sh
python3 - <<'PY' | node scripts/prod-stack.mjs create-user
import getpass, json, sys
with open('/dev/tty') as tty:
    print('Email: ', end='', file=sys.stderr, flush=True)
    email = tty.readline().strip()
password = getpass.getpass('Password (12–256 characters): ')
print(json.dumps({'email': email, 'password': password}))
PY
```

CLI вызывает тот же валидатор, password hashing и транзакцию создания пользователя/workspace. Временная сессия сразу отзывается; токен и пароль не выводятся. Повторный email вызывает отказ; команды сброса пароля и удаления пользователя здесь нет. Откройте публичный HTTPS URL и войдите. Нужен отдельный новый аккаунт для каждого человека; локальные данные не копируются автоматически. Перенос пользовательского JSON делается через существующий экран импорта после проверки аккаунта назначения.

## Следующие выпуски и сбой

Перед обновлением сохраните исходники прошлого выпуска; копируйте новые файлы в тот же каталог, сохраняя `.env.production`, `.production-state/` и volumes. Затем повторите `deploy`. Каждый выпуск имеет уникальные API/web image tags; старые образы не перетегируются и не удаляются. Не запускайте `docker image prune`, пока нужен откат. Сборка происходит до остановки старого API; полная копия — до любой миграции. Миграции дают короткое окно недоступности. Не запускайте две операции выпуска одновременно: общий lock блокирует одновременные deploy/rollback/stop/create-user.

При сбое сборки работающий выпуск сохраняется. Если миграция или последующая проверка падает, прошлый успешный выпуск, его образы, `.production-state/.../pending.json` и резервная копия остаются; автоматического возврата БД нет. После начала миграции API может оставаться остановленным. Сначала изучите вывод и миграции. Только если предыдущий код совместим с уже получившейся схемой:

```sh
node scripts/prod-stack.mjs rollback --schema-compatible
```

После начала ведения `AccountHistory` нельзя откатывать API к выпуску до автоматического месячного закрытия только потому, что SQL-схема обратно совместима. Старый API меняет `Account`, но не дописывает журнал; последующий запуск новой версии тогда восстановит месяцы по устаревшим состояниям. `--schema-compatible` не проверяет этот инвариант. Для такого перехода нужен отдельный согласованный план с остановкой записи и новой доверенной точкой истории (либо восстановлением подходящей полной копии в новую БД); нельзя продолжать прежнее покрытие журнала как достоверное. Штатный откат допустим только к коду, который сохраняет тот же журнал полных состояний и семантику месячных закрытий.


Команда возвращает сохранённые API/web образы, не выполняет миграции вниз и не восстанавливает БД поверх данных. Если схема несовместима, исправьте выпуск вперёд либо подготовьте восстановление в **новой** БД и отдельно согласуйте переключение. Копия до обновления не содержит последующих записей; слепой restore теряет их. Не удаляйте lock при живом процессе; после аварийного завершения проверьте отсутствие запущенной операции перед удалением только `operation.lock`.

Остановка без удаления данных: `node scripts/prod-stack.mjs stop`. Не используйте `down -v`, volume prune, удаление БД или пересоздание существующего DB-volume.

## Полная копия и доказательство восстановления

```sh
node scripts/prod-backup.mjs
node scripts/prod-restore-check.mjs .production-state/tradeledger-prod/backups/FILE.dump
```

Копия содержит всю БД `tradeledger`: аккаунты с password hashes, сессии, все рабочие наборы, архивы и историю. Это чувствительные данные. Формат PostgreSQL custom, portable; `pg_restore --list` проверяет структуру перед атомарным переименованием `.partial` в `.dump`; файл и SHA-256 manifest имеют права 0600. Сбой оставляет partial, который не считается готовой копией. Проверка восстановления сначала сверяет checksum, создаёт новое уникальное `tradeledger_restore_*`, восстанавливает без `--clean` и печатает количества строк всех public tables. Рабочая БД не очищается и не заменяется. Тестовую БД сохраняют для ручной проверки; удаление не автоматизировано. Роли кластера не включаются в dump: отдельный защищённый `.env.production` нужен для bootstrap нового сервера. Политика grants применяется заново.

Для аварийного восстановления на новом сервере сначала разверните отдельный новый контур, скопируйте `.dump` и соседний `.json` в его защищённый backup-каталог, запустите restore-check и проверьте пользователей/учёт в новой БД. Переключение приложения на восстановленную БД делается отдельным осознанным шагом после проверки; этот комплект не делает разрушительный restore на рабочую БД.

Копии на том же VPS не защищают от потери VPS. Подготовлен optional off-host путь: установите `restic`, настройте отдельный SFTP/Hetzner Storage Box repository и ключ пользователя backup. Проверьте fingerprint сервера по независимому каналу и сохраните в `known_hosts`; права SSH-каталога 0700, ключа/конфигурации 0600, доступ только владельцу. В защищённом файле `/etc/tradeledger/backup.env` (0600, владелец root; не в исходниках) задайте `RESTIC_REPOSITORY` (SFTP URL без пароля) и `RESTIC_PASSWORD_COMMAND` (менеджер секретов/защищённый helper), выполните `restic init` **вручную**, затем включите расписание. `prod-backup.mjs` при наличии этих переменных шифрует и отправляет готовые dump+manifest через restic с `BatchMode=yes`, `StrictHostKeyChecking=yes`, ограниченным connect timeout; ошибки удалённой копии дают ненулевой exit, локальная копия сохраняется. Пустые переменные означают только локальную копию. Секреты и SSH-ключи не входят в репозиторий. Удалённая отправка сейчас не выполнялась и не проверялась.

Шаблоны [service](./systemd/tradeledger-backup.service) и [timer](./systemd/tradeledger-backup.timer) ничего не устанавливают сами. На сервере проверьте пути Node, пользователя и рабочий каталог; настройте защищённое окружение restic; после ручной успешной копии установите units и активируйте timer. Контролируйте `systemctl status tradeledger-backup.timer` и `journalctl -u tradeledger-backup.service`, свободное место и возраст последней **off-host** копии. Минимум: ежедневная копия, перед каждым обновлением, регулярный тест восстановления. Автоматическое удаление старых копий/retention и платные сервисы намеренно не включены; задайте их после оценки объёма, чтобы не удалить единственную пригодную копию. Периодически скачивайте off-host копию через `restic restore` в отдельный каталог и повторяйте restore-check.

## Локальная проверка подготовленного контура

```sh
node --test scripts/prod-ops.test.mjs
node scripts/prod-smoke.mjs
```

Smoke создаёт уникальный `tradeledger-prod-smoke-*`, случайные секреты только в памяти, отдельные volumes и high ports только на 127.0.0.1. TLS — внутренняя CA Caddy; извлекается только публичный root certificate в `.cache/`, клиент проверяет цепочку именно этим CA (без `-k`, без установки системного доверия). Проверяются HTTPS readiness/frontend, отказ публичной регистрации именно контроллером, создание через CLI, вход и cookie Secure/HttpOnly/SameSite, неправильный Origin, отсутствие host ports у API/DB/web, запись учёта, full backup/restore с совпадением всех table counts, баланса и входа восстановленного пользователя, сохранность исходной БД, stop/start persistence. Контейнеры останавливаются в finally, тестовые БД/volumes сохраняются. Реальный DNS, ACME, firewall, SSH и off-host restore проверяются только после создания сервера.

Технические первоисточники: [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [restic SFTP](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#sftp).

IP HTTPS: [Let’s Encrypt IP certificates](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [Caddy ACME profile](https://caddyserver.com/docs/caddyfile/directives/tls#profile), [Caddy default_sni](https://caddyserver.com/docs/caddyfile/options#default-sni).
