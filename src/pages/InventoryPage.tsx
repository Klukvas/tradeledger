import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { createCommandMeta, createId, useLedger } from "../data";
import { formatMoney } from "../domain/money";
import { getStockTotal } from "../domain/selectors";
import type { Failure, InventoryItem } from "../domain/types";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  PageHeader,
  StatCard,
} from "../ui";
import { InventoryFields } from "./inventory/InventoryFields";
import {
  actionTitles,
  averageCost,
  validateDraft,
  type DraftErrors,
  type InventoryAction,
  type InventoryDraft,
} from "./inventory/draft";

export function InventoryPage(): ReactElement {
  const { snapshot, dispatch, refresh } = useLedger();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<InventoryDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [didRefresh, setDidRefresh] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const pending = useRef(false);
  const busy = isSaving || (snapshot.status === "ready" && snapshot.busy);

  function open(action: InventoryAction, item?: InventoryItem): void {
    if (snapshot.status !== "ready" || busy || pending.current) return;
    setDraft({
      action,
      id: item?.id ?? createId(),
      meta: createCommandMeta(),
      revision: snapshot.document.revision,
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      quantity: action === "create" ? "0" : "",
      cost: "",
      reason: "",
    });
    setErrors({});
    setFailure(null);
    setDidRefresh(false);
    setConfirmation("");
  }

  function close(): void {
    if (!busy && !pending.current) setDraft(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !draft ||
      snapshot.status !== "ready" ||
      busy ||
      pending.current ||
      failure?.code === "CONFLICT"
    )
      return;
    const item = snapshot.document.state.inventory.find(
      (entry) => entry.id === draft.id,
    );
    const result = validateDraft(draft, item);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    pending.current = true;
    setIsSaving(true);
    setFailure(null);
    setErrors({});
    try {
      const saved = await dispatch(result.command, draft.revision);
      if (saved.ok) {
        setDraft(null);
        setConfirmation(
          draft.action === "create"
            ? "Товар добавлен."
            : draft.action === "update"
              ? "Данные товара сохранены."
              : draft.action === "receive"
                ? "Приход сохранён."
                : "Списание сохранено.",
        );
      } else {
        setFailure(saved.error);
        setDidRefresh(false);
      }
    } catch {
      setFailure({
        code: "STORAGE",
        message:
          "Не удалось сохранить изменения. Черновик сохранён; повторите попытку.",
      });
    } finally {
      pending.current = false;
      setIsSaving(false);
    }
  }

  async function reviewConflict(): Promise<void> {
    if (busy || pending.current) return;
    pending.current = true;
    setIsSaving(true);
    try {
      await refresh();
      setDidRefresh(true);
    } catch {
      setFailure({
        code: "CONFLICT",
        message:
          "Не удалось обновить данные. Повторите обновление перед сохранением.",
      });
    } finally {
      pending.current = false;
      setIsSaving(false);
    }
  }

  function acceptRevision(): void {
    if (!draft || snapshot.status !== "ready" || busy || pending.current)
      return;
    setDraft({ ...draft, revision: snapshot.document.revision });
    setFailure(null);
    setDidRefresh(false);
    setErrors({});
  }

  if (snapshot.status !== "ready")
    return (
      <section className="page">
        <PageHeader
          title="Склад"
          description="Товары и их закупочная стоимость."
        />
        {snapshot.status === "loading" ? (
          <p role="status">Загружаем склад…</p>
        ) : (
          <InlineError message="Склад недоступен. Восстановите доступ к локальным данным в настройках." />
        )}
      </section>
    );

  const items = snapshot.document.state.inventory;
  const query = search.trim().toLocaleLowerCase("ru");
  const filtered = items.filter((item) =>
    `${item.sku}\n${item.name}`.toLocaleLowerCase("ru").includes(query),
  );
  const totalQuantity = items.reduce(
    (total, item) => total + BigInt(item.quantity),
    0n,
  );
  const selected = draft
    ? items.find((item) => item.id === draft.id)
    : undefined;
  const needsReview = failure?.code === "CONFLICT";

  return (
    <section className="page">
      <PageHeader
        title="Склад"
        description="Остатки товаров и вложенные в них закупочные средства."
        action={
          <Button disabled={busy} onClick={() => open("create")}>
            Добавить товар
          </Button>
        }
      />
      {confirmation && (
        <p className="success-message" role="status">
          {confirmation}
        </p>
      )}
      <div className="stats-grid">
        <StatCard
          label="Позиций"
          value={items.length.toLocaleString("ru-RU")}
        />
        <StatCard
          label="Всего единиц"
          value={totalQuantity.toLocaleString("ru-RU")}
        />
        <StatCard
          label="Стоимость склада"
          value={formatMoney(getStockTotal(snapshot.document.state))}
          hint="По закупочной стоимости"
        />
      </div>
      <section className="panel" aria-label="Товары на складе">
        <div className="panel-header">
          <h2>Товары</h2>
          <span className="text-muted text-small">
            Остатки счетов обновляются отдельно
          </span>
        </div>
        <div className="toolbar">
          <Field label="Поиск по артикулу или названию">
            <input
              type="search"
              name="inventory-search"
              autoComplete="off"
              placeholder="Артикул или название"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>
        {items.length === 0 ? (
          <EmptyState
            title="На складе пока нет товаров"
            description="Добавьте первый товар и укажите его начальный остаток и закупочную цену."
            action={
              <Button disabled={busy} onClick={() => open("create")}>
                Добавить первый товар
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Товары не найдены"
            description="Попробуйте другой артикул или название либо очистите поиск."
            action={
              <Button variant="secondary" onClick={() => setSearch("")}>
                Очистить поиск
              </Button>
            }
          />
        ) : (
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Таблица товаров: прокрутите для просмотра всех столбцов"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Товар / артикул</th>
                  <th scope="col" className="text-right">
                    Остаток, шт.
                  </th>
                  <th scope="col" className="text-right">
                    Средняя закупочная ≈
                  </th>
                  <th scope="col" className="text-right">
                    Стоимость остатка
                  </th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <div className="text-muted text-small">{item.sku}</div>
                    </td>
                    <td className="numeric text-right">
                      {item.quantity.toLocaleString("ru-RU")}
                    </td>
                    <td className="money">{averageCost(item)}</td>
                    <td className="money">
                      {formatMoney(item.stockValueMinor)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => open("receive", item)}
                          aria-label={`Приход: ${item.name}`}
                        >
                          Приход
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || item.quantity === 0}
                          onClick={() => open("issue", item)}
                          aria-label={`Списать: ${item.name}`}
                        >
                          Списать
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => open("update", item)}
                          aria-label={`Изменить: ${item.name}`}
                        >
                          Изменить
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Dialog
        open={draft !== null}
        title={draft ? actionTitles[draft.action] : "Товар"}
        onClose={close}
      >
        {draft && (
          <form
            onSubmit={(event) => {
              void save(event);
            }}
            noValidate
            className="stack"
          >
            {selected && (
              <p className="notice">
                <strong>{selected.name}</strong> · {selected.sku}
                <br />
                Текущий остаток:{" "}
                <span className="numeric">
                  {selected.quantity.toLocaleString("ru-RU")} шт.
                </span>{" "}
                · {formatMoney(selected.stockValueMinor)}
              </p>
            )}
            <InventoryFields
              draft={draft}
              errors={errors}
              disabled={busy}
              onChange={(field, value) =>
                setDraft({ ...draft, [field]: value })
              }
            />
            {(draft.action === "receive" || draft.action === "issue") && (
              <p className="text-muted text-small">
                Остатки счетов обновляются отдельно.
              </p>
            )}
            {failure && <InlineError message={failure.message} />}
            {needsReview && (
              <div className="stack">
                <p className="text-small">
                  Обновите данные, проверьте текущий остаток и введённые
                  значения. Черновик сохранён.
                </p>
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    busy={busy}
                    onClick={() => {
                      void reviewConflict();
                    }}
                  >
                    Обновить данные
                  </Button>
                  {didRefresh && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={acceptRevision}
                    >
                      Данные проверены, разрешить повтор
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="form-actions">
              <Button variant="secondary" disabled={busy} onClick={close}>
                Отмена
              </Button>
              <Button type="submit" busy={busy} disabled={needsReview}>
                {draft.action === "issue" ? "Списать" : "Сохранить"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
