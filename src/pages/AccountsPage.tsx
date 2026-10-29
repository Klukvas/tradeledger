import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { createCommandMeta, createId, useLedger } from "../data";
import { formatMoney } from "../domain/money";
import { getAccountsTotal } from "../domain/selectors";
import { MonthlyMoneyStat } from "./shared/MonthlyMoneyStat";
import type { Account, Failure } from "../domain/types";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  PageHeader,
  StatCard,
} from "../ui";
import { AccountFields, AccountReview } from "./accounts/AccountFields";
import {
  actionTitles,
  balanceInput,
  providerLabels,
  validateDraft,
  type AccountAction,
  type AccountDraft,
  type DraftErrors,
} from "./accounts/draft";

export function AccountsPage(): ReactElement {
  const { snapshot, dispatch, refresh } = useLedger();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [didRefresh, setDidRefresh] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const pending = useRef(false);
  const busy = isSaving || (snapshot.status === "ready" && snapshot.busy);

  function open(action: AccountAction, account?: Account): void {
    if (snapshot.status !== "ready" || busy || pending.current) return;
    setDraft({
      action,
      id: account?.id ?? createId(),
      meta: createCommandMeta(),
      revision: snapshot.document.revision,
      name: account?.name ?? "",
      owner: account?.owner ?? "",
      provider: account?.provider ?? "MONO",
      balance: account ? balanceInput(account.balanceMinor) : "",
      original: account ?? null,
    });
    setErrors({});
    setFailure(null);
    setDidRefresh(false);
    setConfirmation("");
  }

  function close(): void {
    if (!busy && !pending.current) setDraft(null);
  }

  async function saveDraft(next: AccountDraft): Promise<void> {
    if (snapshot.status !== "ready" || busy || pending.current) return;
    const result = validateDraft(next);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    pending.current = true;
    setIsSaving(true);
    setFailure(null);
    setErrors({});
    try {
      const saved = await dispatch(result.command, next.revision);
      if (saved.ok) {
        setDraft(null);
        setConfirmation(
          next.action === "create"
            ? "Счёт добавлен."
            : next.action === "update"
              ? "Данные счёта сохранены."
              : "Баланс обновлён.",
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

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft && failure?.code !== "CONFLICT") void saveDraft(draft);
  }

  async function reviewConflict(): Promise<void> {
    if (busy || pending.current) return;
    pending.current = true;
    setIsSaving(true);
    setDidRefresh(false);
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

  function retryReviewed(): void {
    if (
      !draft ||
      !didRefresh ||
      snapshot.status !== "ready" ||
      snapshot.error !== null ||
      busy ||
      pending.current
    )
      return;
    const reviewed = { ...draft, revision: snapshot.document.revision };
    setDraft(reviewed);
    void saveDraft(reviewed);
  }

  if (snapshot.status !== "ready")
    return (
      <section className="page">
        <PageHeader
          title="Счета"
          description="Текущие остатки на счетах ФОП."
        />
        {snapshot.status === "loading" ? (
          <p role="status">Загружаем счета…</p>
        ) : (
          <InlineError message="Счета недоступны. Восстановите доступ к локальным данным в настройках." />
        )}
      </section>
    );

  const state = snapshot.document.state;
  const query = search.trim().toLocaleLowerCase("ru");
  const filtered = state.accounts.filter((account) =>
    `${account.name}\n${account.owner}\n${providerLabels[account.provider]}`
      .toLocaleLowerCase("ru")
      .includes(query),
  );
  const selected = draft
    ? state.accounts.find((account) => account.id === draft.id)
    : undefined;
  const needsReview = failure?.code === "CONFLICT";
  const canRetryReviewed = didRefresh && snapshot.error === null;
  return (
    <section className="page">
      <PageHeader
        title="Счета"
        description="Ручной учёт текущих остатков на счетах ФОП. Все суммы в UAH."
        action={
          <Button disabled={busy} onClick={() => open("create")}>
            Добавить счёт
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
          label="Всего на счетах"
          value={formatMoney(getAccountsTotal(state))}
          hint={`${state.accounts.length.toLocaleString("ru-RU")} счетов`}
        />
        <MonthlyMoneyStat state={state} />
      </div>
      <p className="text-muted text-small">
        Изменение за месяц — текущая сумма всех счетов минус сумма из
        автоматического закрытия прошлого календарного месяца (Киев), не
        прибыль. Месяц закрывается первого числа в 00:00 по Киеву. До первого
        закрытия сравнение недоступно. Обновление баланса не меняет склад или
        долги.
      </p>
      <section className="panel" aria-label="Счета ФОП">
        <div className="panel-header">
          <h2>Счета ФОП</h2>
          <span className="text-muted text-small">Фактические остатки</span>
        </div>
        <div className="toolbar">
          <Field label="Поиск по названию, ФОП или провайдеру">
            <input
              type="search"
              name="accounts-search"
              autoComplete="off"
              placeholder="Название, ФОП или провайдер"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>
        {state.accounts.length === 0 ? (
          <EmptyState
            title="Пока нет счетов"
            description="Добавьте первый счёт ФОП и укажите фактический остаток."
            action={
              <Button disabled={busy} onClick={() => open("create")}>
                Добавить первый счёт
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Счета не найдены"
            description="Измените запрос или очистите поиск."
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
            aria-label="Таблица счетов: прокрутите для просмотра всех столбцов"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Название</th>
                  <th scope="col">Владелец (ФОП)</th>
                  <th scope="col">Провайдер</th>
                  <th scope="col" className="text-right">
                    Текущий баланс
                  </th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.name}</strong>
                    </td>
                    <td>{account.owner}</td>
                    <td>{providerLabels[account.provider]}</td>
                    <td className="money">
                      {formatMoney(account.balanceMinor)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => open("balance", account)}
                          aria-label={`Обновить баланс: ${account.name}, ${account.owner}`}
                        >
                          Обновить баланс
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => open("update", account)}
                          aria-label={`Изменить данные: ${account.name}, ${account.owner}`}
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
        title={draft ? actionTitles[draft.action] : "Счёт"}
        onClose={close}
      >
        {draft && (
          <form onSubmit={save} noValidate className="stack">
            {selected && (
              <p className="notice">
                <strong>{selected.name}</strong> · {selected.owner} ·{" "}
                {providerLabels[selected.provider]}
                <br />
                Текущий баланс:{" "}
                <span className="money">
                  {formatMoney(selected.balanceMinor)}
                </span>
              </p>
            )}
            <AccountFields
              draft={draft}
              errors={errors}
              disabled={busy}
              onChange={(changes) => setDraft({ ...draft, ...changes })}
            />
            {failure && <InlineError message={failure.message} />}
            {needsReview && (
              <div className="stack">
                <p className="text-small">
                  Данные изменились. Обновите список и сверьте значения.
                  Черновик сохранён.
                </p>
                {didRefresh && snapshot.error && (
                  <p className="text-small">
                    Не удалось получить актуальные данные. Повторите обновление.
                  </p>
                )}
                {canRetryReviewed && (
                  <AccountReview draft={draft} current={selected} />
                )}
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
                  {canRetryReviewed && (
                    <Button
                      variant="secondary"
                      disabled={
                        busy || (draft.action !== "create" && !selected)
                      }
                      onClick={retryReviewed}
                    >
                      Сверился, повторить сохранение
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
                Сохранить
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
