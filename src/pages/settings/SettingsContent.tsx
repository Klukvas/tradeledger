import { useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { useLedger, exportServerBackup } from "../../data";
import { LegacyTransfer } from "./LegacyTransfer";
import { MAX_BACKUP_BYTES, parseBackup } from "../../data/backups";
import type { Failure } from "../../domain/types";
import { Button, Field, InlineError, PageHeader } from "../../ui";
import { documentCounts, downloadBackup, type ImportPreview } from "./backup";

export function SettingsPage({ email = "" }: { email?: string }): ReactElement {
  const { snapshot, importBackup, refresh } = useLedger();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [exportError, setExportError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [didRefresh, setDidRefresh] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy =
    isWorking || exporting || (snapshot.status === "ready" && snapshot.busy);
  const needsReview = failure?.code === "CONFLICT";

  async function exportFile(): Promise<void> {
    if (pending.current || exportingRef.current || busy) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    try {
      const result = await exportServerBackup();
      if (!result.ok) {
        setExportError(result.error.message);
        return;
      }
      downloadBackup(result.value);
    } catch {
      setExportError("Не удалось скачать резервную копию. Повторите попытку.");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }
  async function chooseFile(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];
    if (!file || snapshot.status !== "ready" || pending.current || busy) return;
    setPreview(null);
    setConfirmed(false);
    setFailure(null);
    setConfirmation("");
    setDidRefresh(false);
    if (file.size > MAX_BACKUP_BYTES) {
      setFailure({
        code: "VALIDATION",
        message:
          "Файл превышает допустимый размер 5 МБ. Выберите другую копию.",
      });
      return;
    }
    const revision = snapshot.document.revision;
    const original = snapshot.document.state;
    pending.current = true;
    setIsWorking(true);
    try {
      const json = await file.text();
      const parsed = parseBackup(json);
      if (!parsed.ok) {
        setFailure(parsed.error);
        return;
      }
      setPreview({
        json,
        filename: file.name,
        document: parsed.value,
        revision,
        original,
      });
    } catch {
      setFailure({
        code: "VALIDATION",
        message:
          "Не удалось прочитать файл. Выберите JSON резервной копии ещё раз.",
      });
    } finally {
      pending.current = false;
      setIsWorking(false);
    }
  }
  async function restore(): Promise<void> {
    if (
      !preview ||
      !confirmed ||
      needsReview ||
      snapshot.status !== "ready" ||
      busy ||
      pending.current
    )
      return;
    pending.current = true;
    setIsWorking(true);
    setFailure(null);
    try {
      const result = await importBackup(preview.json, preview.revision);
      if (result.ok) {
        setPreview(null);
        setConfirmed(false);
        setConfirmation("Данные заменены резервной копией.");
        if (fileInput.current) fileInput.current.value = "";
      } else {
        setFailure(result.error);
        setConfirmed(false);
        setDidRefresh(false);
      }
    } catch {
      setFailure({
        code: "STORAGE",
        message:
          "Не удалось восстановить копию. Файл сохранён для повторной попытки.",
      });
    } finally {
      pending.current = false;
      setIsWorking(false);
    }
  }
  async function reviewPreview(): Promise<void> {
    if (!preview || busy || pending.current) return;
    pending.current = true;
    setIsWorking(true);
    setConfirmed(false);
    setDidRefresh(false);
    try {
      await refresh();
      setDidRefresh(true);
    } catch {
      setFailure({
        code: "CONFLICT",
        message:
          "Не удалось обновить данные. Повторите обновление предпросмотра.",
      });
    } finally {
      pending.current = false;
      setIsWorking(false);
    }
  }
  function acceptReview(): void {
    if (
      !preview ||
      !didRefresh ||
      (snapshot.status === "ready" && snapshot.error !== null) ||
      snapshot.status !== "ready" ||
      busy ||
      pending.current
    )
      return;
    setPreview({
      ...preview,
      revision: snapshot.document.revision,
      original: snapshot.document.state,
    });
    setConfirmed(false);
    setFailure(null);
  }
  if (snapshot.status !== "ready")
    return (
      <section className="page">
        <PageHeader
          title="Резервная копия"
          description="Резервная копия записей аккаунта"
        />
      </section>
    );
  return (
    <section className="page">
      <PageHeader
        title="Резервная копия"
        description="Серверные данные и резервные копии"
      />
      <section className="panel stack">
        <h2>Данные вашего аккаунта</h2>
        <p>
          Учёт хранится на сервере и доступен после входа в ваш аккаунт с
          другого устройства. Счета и остатки вы обновляете вручную. Подключения
          к банкам нет.
        </p>
        <p className="text-muted">
          Регулярно скачивайте резервную копию. JSON содержит все записи,
          фиксации балансов и историю активного учёта; это не полная копия
          серверной базы данных.
        </p>
        <p className="text-small numeric">
          {documentCounts(snapshot.document.state)}
        </p>
        <div>
          <Button
            variant="secondary"
            busy={exporting}
            disabled={busy}
            onClick={() => void exportFile()}
          >
            Скачать резервную копию
          </Button>
        </div>
        {exportError && <InlineError message={exportError} />}
      </section>
      <LegacyTransfer
        email={email}
        document={snapshot.document}
        serverBusy={busy}
        serverError={snapshot.error !== null}
        refresh={refresh}
      />
      <section className="panel stack" aria-labelledby="restore-title">
        <h2 id="restore-title">Восстановление из копии</h2>
        <p>
          Загрузка полностью заменяет активные записи аккаунта содержимым файла.
          Прежний серверный набор сохраняется в архиве. Записи не объединяются.
          Сначала скачайте текущую копию выше.
        </p>
        <Field
          label="Файл резервной копии"
          hint="JSON, до 5 МБ. Проверим файл и покажем состав; сервер проверит его повторно."
        >
          <input
            ref={fileInput}
            type="file"
            name="backupFile"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              void chooseFile(event);
            }}
          />
        </Field>
        {isWorking && <p role="status">Обрабатываем резервную копию…</p>}
        {failure && <InlineError message={failure.message} />}
        {confirmation && (
          <p role="status" className="success-message">
            {confirmation}
          </p>
        )}
        {preview && (
          <div className="stack">
            <div className="notice">
              <h3>Предпросмотр: {preview.filename}</h3>
              <p>
                Текущие данные аккаунта:{" "}
                <span className="numeric">
                  {documentCounts(
                    needsReview ? snapshot.document.state : preview.original,
                  )}
                </span>
              </p>
              <p>
                В копии:{" "}
                <span className="numeric">
                  {documentCounts(preview.document.state)}
                </span>
              </p>
              <p className="text-small text-muted">
                Копия сохранена:{" "}
                <time dateTime={preview.document.updatedAt}>
                  {new Intl.DateTimeFormat("ru-RU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Europe/Kyiv",
                  }).format(new Date(preview.document.updatedAt))}{" "}
                  (Киев)
                </time>
              </p>
            </div>
            {needsReview ? (
              <div className="stack">
                <p>
                  Данные изменились после предпросмотра. Сверьте обновлённый
                  состав перед заменой. Выбранный файл сохранён.
                </p>
                <div className="inline-actions">
                  <Button
                    variant="secondary"
                    busy={busy}
                    onClick={() => {
                      void reviewPreview();
                    }}
                  >
                    Обновить предпросмотр
                  </Button>
                  {didRefresh && snapshot.error === null && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={acceptReview}
                    >
                      Состав проверен, подтвердить предпросмотр
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <label className="checkbox-label">
                  <input
                    name="confirmRestore"
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  Подтверждаю полную замену текущих данных
                </label>
                <div>
                  <Button
                    variant="danger"
                    busy={busy}
                    disabled={!confirmed}
                    onClick={() => {
                      void restore();
                    }}
                  >
                    Заменить данные резервной копией
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </section>
  );
}
