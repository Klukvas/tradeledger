import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { createCommandMeta, createId, useLedger } from "../data";
import { formatMoney } from "../domain/money";
import { getDebtTotals } from "../domain/selectors";
import type { Debt, DebtDirection, Failure } from "../domain/types";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  PageHeader,
  StatCard,
} from "../ui";
import { DebtAmounts, DebtFields } from "./debts/DebtFields";
import { DebtTable } from "./debts/DebtTable";
import {
  actionTitles,
  directionLabels,
  minorToInput,
  outstanding,
  repaymentNotice,
  validateDebtDraft,
  type DebtAction,
  type DebtDraft,
  type DebtErrors,
} from "./debts/draft";

export function DebtsPage(): ReactElement {
  const { snapshot, dispatch, refresh } = useLedger();
  const [direction, setDirection] = useState<DebtDirection>("payable");
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DebtDraft | null>(null);
  const [errors, setErrors] = useState<DebtErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [didRefresh, setDidRefresh] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const pending = useRef(false);
  const busy = isSaving || (snapshot.status === "ready" && snapshot.busy);
  const needsReview = failure?.code === "CONFLICT";

  function open(action: DebtAction, debt?: Debt): void {
    if (snapshot.status !== "ready" || busy || pending.current) return;
    if (action === "repay" && (!debt || outstanding(debt) === 0)) return;
    setDraft({
      action,
      id: debt?.id ?? createId(),
      meta: createCommandMeta(),
      revision: snapshot.document.revision,
      direction: debt?.direction ?? direction,
      counterparty: debt?.counterparty ?? "",
      principal: debt ? minorToInput(debt.principalMinor) : "",
      note: debt?.note ?? "",
      amount: "",
      original: debt,
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
      needsReview
    )
      return;
    const result = validateDebtDraft(draft);
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
          draft.action === "repay"
            ? "Погашение сохранено."
            : draft.action === "create"
              ? "Долг добавлен."
              : "Данные долга сохранены.",
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

  function acceptRevision(): void {
    if (
      !draft ||
      snapshot.status !== "ready" ||
      snapshot.error ||
      busy ||
      pending.current ||
      !didRefresh ||
      !needsReview
    )
      return;
    const current = snapshot.document.state.debts.find(
      (debt) => debt.id === draft.id,
    );
    if (draft.action !== "create" && !current) return;
    setDraft({
      ...draft,
      revision: snapshot.document.revision,
      original: current,
    });
    setFailure(null);
    setDidRefresh(false);
    setErrors({});
  }

  if (snapshot.status !== "ready")
    return (
      <section className="page">
        <PageHeader
          title="Долги"
          description="Личные долги к оплате и получению."
        />
        {snapshot.status === "loading" ? (
          <p role="status">Загружаем долги…</p>
        ) : (
          <InlineError message="Долги недоступны. Восстановите доступ к локальным данным в настройках." />
        )}
      </section>
    );

  const debts = snapshot.document.state.debts;
  const totals = getDebtTotals(snapshot.document.state);
  const query = search.trim().toLocaleLowerCase("ru");
  const filtered = debts.filter(
    (debt) =>
      debt.direction === direction &&
      (outstanding(debt) === 0) === showClosed &&
      `${debt.counterparty}\n${debt.note}`
        .toLocaleLowerCase("ru")
        .includes(query),
  );
  const current = draft
    ? debts.find((debt) => debt.id === draft.id)
    : undefined;
  const missingDebt = draft && draft.action !== "create" && !current;

  return (
    <section className="page">
      <PageHeader
        title="Долги"
        description="Личные займы: кому вы должны и кто должен вам."
        action={
          <Button disabled={busy} onClick={() => open("create")}>
            Добавить долг
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
          label="Я должен"
          value={formatMoney(totals.payable)}
          hint="Осталось выплатить"
          tone="negative"
        />
        <StatCard
          label="Мне должны"
          value={formatMoney(totals.receivable)}
          hint="Осталось получить"
          tone="positive"
        />
      </div>
      <p className="notice">{repaymentNotice}</p>
      <section className="panel stack" aria-label="Список долгов">
        <div className="panel-header">
          <h2>{directionLabels[direction]}</h2>
          <span className="text-muted text-small">
            {showClosed ? "История закрытых долгов" : "Активные долги"}
          </span>
        </div>
        <div className="toolbar">
          <div
            className="toolbar-group"
            role="group"
            aria-label="Направление долгов"
          >
            {(["payable", "receivable"] as const).map((value) => (
              <Button
                key={value}
                variant={direction === value ? "primary" : "ghost"}
                aria-pressed={direction === value}
                onClick={() => setDirection(value)}
              >
                {directionLabels[value]}
              </Button>
            ))}
          </div>
          <div
            className="toolbar-group"
            role="group"
            aria-label="Статус долгов"
          >
            <Button
              variant={!showClosed ? "secondary" : "ghost"}
              aria-pressed={!showClosed}
              onClick={() => setShowClosed(false)}
            >
              Активные
            </Button>
            <Button
              variant={showClosed ? "secondary" : "ghost"}
              aria-pressed={showClosed}
              onClick={() => setShowClosed(true)}
            >
              Закрытые
            </Button>
          </div>
          <Field label="Поиск по контрагенту или примечанию">
            <input
              type="search"
              name="debt-search"
              autoComplete="off"
              placeholder="Имя или примечание"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>
        {filtered.length ? (
          <DebtTable
            debts={filtered}
            busy={busy}
            onEdit={(debt) => open("update", debt)}
            onRepay={(debt) => open("repay", debt)}
          />
        ) : (
          <EmptyState
            title={
              query
                ? "Долги не найдены"
                : showClosed
                  ? "Закрытых долгов пока нет"
                  : "Активных долгов пока нет"
            }
            description={
              query
                ? "Измените контрагента или примечание в поиске либо очистите фильтр."
                : showClosed
                  ? "Полностью погашенные долги сохраняются здесь для истории."
                  : "Добавьте займ в выбранном направлении или посмотрите закрытые долги."
            }
            action={
              query ? (
                <Button variant="secondary" onClick={() => setSearch("")}>
                  Очистить поиск
                </Button>
              ) : !showClosed ? (
                <Button disabled={busy} onClick={() => open("create")}>
                  Добавить первый долг
                </Button>
              ) : undefined
            }
          />
        )}
      </section>
      <Dialog
        open={draft !== null}
        title={draft ? actionTitles[draft.action] : "Долг"}
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
            {draft.original && (
              <DebtAmounts
                debt={draft.original}
                heading="Долг на момент открытия"
              />
            )}
            <DebtFields
              draft={draft}
              errors={errors}
              disabled={busy}
              onChange={(field, value) => {
                if (field === "direction") {
                  if (
                    draft.action === "create" &&
                    (value === "payable" || value === "receivable")
                  )
                    setDraft({ ...draft, direction: value });
                } else setDraft({ ...draft, [field]: value });
              }}
            />
            {draft.action === "repay" && (
              <p className="text-muted text-small">{repaymentNotice}</p>
            )}
            {failure && <InlineError message={failure.message} />}
            {needsReview && (
              <div className="stack">
                <p className="text-small">
                  Обновите данные, сравните текущие суммы с черновиком и
                  подтвердите проверку перед повтором. Черновик сохранён.
                </p>
                {current && (
                  <DebtAmounts debt={current} heading="Текущие данные" />
                )}
                {missingDebt && (
                  <InlineError message="Долг отсутствует в текущих данных. Закройте диалог и проверьте список долгов." />
                )}
                {didRefresh && snapshot.error && (
                  <InlineError message="Обновление не удалось. Повторите его перед подтверждением." />
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
                  {didRefresh && (
                    <Button
                      variant="secondary"
                      disabled={
                        busy || Boolean(missingDebt) || Boolean(snapshot.error)
                      }
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
                {draft.action === "repay" ? "Сохранить погашение" : "Сохранить"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
