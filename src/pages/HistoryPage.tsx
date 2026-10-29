import { type ReactElement } from "react";
import { useLedger } from "../data";
import type { AuditEvent } from "../domain/types";
import { Badge, Button, EmptyState, Field, PageHeader } from "../ui";

const eventLabels: Record<AuditEvent["type"], string> = {
  "inventory.create": "Добавление товара",
  "inventory.update": "Изменение товара",
  "inventory.receive": "Приход товара",
  "inventory.issue": "Расход товара",
  "account.create": "Добавление счёта",
  "account.update": "Изменение счёта",
  "account.setBalance": "Изменение баланса",
  "debt.create": "Добавление долга",
  "debt.update": "Изменение долга",
  "debt.repay": "Погашение долга",
  "snapshot.create": "Фиксация балансов",
};

const timestamp = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});

function EventTime({ event }: { event: AuditEvent }): ReactElement {
  const date = new Date(event.at);
  return (
    <time className="numeric" dateTime={event.at}>
      {Number.isNaN(date.getTime())
        ? "Дата недоступна"
        : timestamp.format(date)}
    </time>
  );
}

function HistoryEntries({
  events,
}: {
  events: readonly AuditEvent[];
}): ReactElement {
  return (
    <>
      <div
        className="table-wrap desktop-table"
        role="region"
        aria-label="История операций"
        tabIndex={0}
      >
        <table className="data-table">
          <caption className="text-muted">
            Новые операции сверху. Время — Киев.
          </caption>
          <thead>
            <tr>
              <th scope="col">Дата и время</th>
              <th scope="col">Операция</th>
              <th scope="col">Что изменилось</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <EventTime event={event} />
                </td>
                <td>
                  <Badge>{eventLabels[event.type]}</Badge>
                </td>
                <td>{event.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="record-cards"
        role="list"
        aria-label="Операции — время Киева"
      >
        {events.map((event) => (
          <article className="record-card" key={event.id} role="listitem">
            <h2>{eventLabels[event.type]}</h2>
            <p className="text-muted text-small">
              <EventTime event={event} />
            </p>
            <p>{event.summary}</p>
          </article>
        ))}
      </div>
    </>
  );
}

export type HistoryFilters = Readonly<{ search: string; type: string }>;

type HistoryPageProps = {
  filters: HistoryFilters;
  onFiltersChange: (filters: HistoryFilters) => void;
};

export function HistoryPage({
  filters,
  onFiltersChange,
}: HistoryPageProps): ReactElement {
  const { snapshot } = useLedger();
  const { search, type } = filters;
  if (snapshot.status !== "ready")
    return (
      <div className="page">
        <PageHeader
          title="История"
          description="Ожидаем доступ к локальным данным."
        />
      </div>
    );
  const audit = snapshot.document.state.audit;
  const query = search.trim().toLocaleLowerCase("ru");
  const events = [...audit]
    .reverse()
    .filter(
      (event) =>
        (!type || event.type === type) &&
        `${eventLabels[event.type]} ${event.summary}`
          .toLocaleLowerCase("ru")
          .includes(query),
    )
    .sort((first, second) => Date.parse(second.at) - Date.parse(first.at));
  const reset = (): void => {
    onFiltersChange({ search: "", type: "" });
  };
  return (
    <div className="page">
      <PageHeader
        title="История"
        description="Журнал сохранённых изменений. Новые записи сверху; время указано по Киеву."
      />
      {audit.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="Операций пока нет"
            description="Добавьте товар, счёт или долг — сохранённое изменение появится здесь."
            action={
              <a className="button button-secondary" href="#inventory">
                Перейти на склад
              </a>
            }
          />
        </section>
      ) : (
        <section className="panel stack" aria-label="Журнал изменений">
          <div className="toolbar">
            <div className="toolbar-group">
              <Field label="Поиск по истории">
                <input
                  type="search"
                  name="historySearch"
                  autoComplete="off"
                  placeholder="Название, контрагент, сумма…"
                  value={search}
                  onChange={(event) =>
                    onFiltersChange({ ...filters, search: event.target.value })
                  }
                />
              </Field>
              <Field label="Тип операции">
                <select
                  name="historyType"
                  value={type}
                  onChange={(event) =>
                    onFiltersChange({ ...filters, type: event.target.value })
                  }
                >
                  <option value="">Все операции</option>
                  {Object.entries(eventLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {(search || type) && (
              <Button variant="ghost" onClick={reset}>
                Сбросить фильтры
              </Button>
            )}
          </div>
          <p className="text-muted text-small numeric" role="status">
            Показано {events.length} из {audit.length}
          </p>
          {events.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              description="Попробуйте другой запрос или сбросьте фильтры."
              action={
                <Button variant="secondary" onClick={reset}>
                  Показать все операции
                </Button>
              }
            />
          ) : (
            <HistoryEntries events={events} />
          )}
        </section>
      )}
    </div>
  );
}
