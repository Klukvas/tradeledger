import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  getLegacyTransferStatus,
  transferLegacy,
  type ImportResponse,
  type LegacyTransferStatus,
} from "../../data";
import { hasRecords, useLegacySource } from "../../auth/LegacySource";
import type { DocumentV1, Failure } from "../../domain/types";
import { Button, InlineError } from "../../ui";
import { documentCounts, downloadBackup } from "./backup";

type Preview = Readonly<{
  source: DocumentV1;
  revision: number;
  destination: DocumentV1;
  requestId: string;
}>;
export function LegacyTransfer({
  email,
  document,
  serverBusy,
  refresh,
  serverError = false,
}: {
  email: string;
  document: DocumentV1;
  serverBusy: boolean;
  refresh: () => Promise<void>;
  serverError?: boolean;
}): ReactElement | null {
  const { source, loading, error, retry } = useLegacySource();
  const [status, setStatus] = useState<LegacyTransferStatus | null>(null);
  const [checkedDocument, setCheckedDocument] = useState<DocumentV1 | null>(
    null,
  );
  const [statusError, setStatusError] = useState("");
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [success, setSuccess] = useState<ImportResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const pendingRef = useRef(false);
  const busy = pending || serverBusy;
  const sourceDocument = source?.status === "ready" ? source.document : null;
  const currentStatus = checkedDocument === sourceDocument ? status : null;
  useEffect(() => {
    let active = true;
    if (!sourceDocument || !hasRecords(sourceDocument.state)) return;
    void getLegacyTransferStatus(sourceDocument)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setStatus(result.value);
          setCheckedDocument(sourceDocument);
          setStatusError("");
        } else setStatusError(result.error.message);
      })
      .catch(() => {
        if (active)
          setStatusError(
            "Не удалось проверить историю переноса. Повторите проверку.",
          );
      });
    return () => {
      active = false;
    };
  }, [sourceDocument, statusAttempt]);
  function download(): void {
    if (!source || source.status === "absent" || !source.rawBackup) return;
    try {
      downloadBackup(source.rawBackup, "tradeledger-legacy");
      setDownloadError("");
    } catch {
      setDownloadError("Не удалось скачать исходную копию. Повторите попытку.");
    }
  }
  function openPreview(): void {
    if (!sourceDocument || !currentStatus || currentStatus.transferred || busy)
      return;
    setPreview({
      source: sourceDocument,
      revision: document.revision,
      destination: document,
      requestId: currentStatus.requestId,
    });
    setConfirmed(false);
    setFailure(null);
    setReviewed(false);
  }
  async function transfer(): Promise<void> {
    if (
      !preview ||
      !confirmed ||
      busy ||
      pendingRef.current ||
      failure?.code === "CONFLICT"
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await transferLegacy(
        preview.source,
        preview.revision,
        preview.requestId,
      );
      if (result.ok) {
        // The data layer verifies the persisted receipt before resolving success.
        setSuccess(result.value);
        setPreview(null);
        setConfirmed(false);
        await refresh();
      } else {
        setFailure(result.error);
        setConfirmed(false);
        setReviewed(false);
      }
    } catch {
      setFailure({
        code: "STORAGE",
        message:
          "Не удалось подтвердить перенос. Исходная копия и предпросмотр сохранены. Повторите попытку.",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  async function refreshReview(): Promise<void> {
    if (pendingRef.current || busy) return;
    pendingRef.current = true;
    setPending(true);
    setReviewed(false);
    try {
      await refresh();
      setReviewed(true);
    } catch {
      setFailure({
        code: "CONFLICT",
        message: "Не удалось обновить серверные данные. Повторите чтение.",
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  if (
    loading ||
    (!error &&
      (!source ||
        source.status === "absent" ||
        (source.status === "ready" && !hasRecords(source.document.state))))
  )
    return null;
  return (
    <section className="panel stack" aria-labelledby="legacy-title">
      <h2 id="legacy-title">Перенос прежних данных из браузера</h2>
      <p>
        Получатель: <strong className="account-email">{email}</strong>. Перенос
        полностью заменит активные записи этого аккаунта; объединения нет.
        Прежний серверный набор сохранится в архиве.
      </p>
      <p className="text-muted">
        Исходная копия в этом браузере останется без изменений. До переноса
        скачайте её отдельным JSON.
      </p>
      {source?.status === "ready" && (
        <p className="numeric">
          В браузере: {documentCounts(source.document.state)}
        </p>
      )}
      {source && source.status !== "absent" && source.rawBackup && (
        <div>
          <Button variant="secondary" disabled={busy} onClick={download}>
            Скачать исходную копию
          </Button>
        </div>
      )}
      {downloadError && <InlineError message={downloadError} />}
      {(error || source?.status === "corrupt") && (
        <>
          <InlineError
            message={
              error ||
              (source?.status === "corrupt" ? source.error.message : "")
            }
          />
          <div>
            <Button variant="secondary" disabled={busy} onClick={retry}>
              Повторить чтение прежних данных
            </Button>
          </div>
        </>
      )}
      {statusError && (
        <>
          <InlineError message={statusError} />
          <div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setStatusError("");
                setStatusAttempt((value) => value + 1);
              }}
            >
              Повторить проверку переноса
            </Button>
          </div>
        </>
      )}
      {success ? (
        <div className="notice" role="status">
          <h3>Перенос подтверждён сервером</h3>
          <p>
            {documentCounts(sourceDocument?.state ?? success.document.state)}
          </p>
          <p className="numeric">
            Ревизия переноса: {success.receipt.committedRevision}.
          </p>
          <p>Исходная копия в браузере сохранена.</p>
        </div>
      ) : currentStatus?.transferred ? (
        <p role="status">
          Эта исходная копия уже перенесена в текущий аккаунт. Повторный перенос
          не требуется. Исходная копия в браузере сохранена.
        </p>
      ) : source?.status === "ready" && !preview ? (
        <div>
          <Button disabled={busy || !currentStatus} onClick={openPreview}>
            Проверить перенос в аккаунт
          </Button>
        </div>
      ) : null}
      {failure && <InlineError message={failure.message} />}
      {preview && (
        <div className="stack">
          <div className="notice">
            <h3>Предпросмотр переноса</h3>
            <p>
              Аккаунт назначения:{" "}
              <strong className="account-email">{email}</strong>
            </p>
            <p className="numeric">
              На сервере:{" "}
              {documentCounts(
                failure?.code === "CONFLICT"
                  ? document.state
                  : preview.destination.state,
              )}
            </p>
            <p className="numeric">
              После переноса: {documentCounts(preview.source.state)}
            </p>
          </div>
          {failure?.code === "CONFLICT" ? (
            <>
              <p>
                Серверные записи изменились. Исходная копия и предпросмотр
                сохранены. Обновите данные, сверьте состав и подтвердите перенос
                заново.
              </p>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  busy={pending}
                  disabled={serverBusy}
                  onClick={() => void refreshReview()}
                >
                  Обновить данные перед переносом
                </Button>
                {reviewed && !serverError && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setPreview({
                        ...preview,
                        revision: document.revision,
                        destination: document,
                      });
                      setFailure(null);
                      setConfirmed(false);
                      setReviewed(false);
                    }}
                  >
                    Состав проверен, продолжить перенос
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="checkbox-label">
                <input
                  name="confirmLegacyTransfer"
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {hasRecords(preview.destination.state)
                  ? "Подтверждаю архивирование и полную замену записей аккаунта"
                  : "Подтверждаю перенос в указанный аккаунт"}
              </label>
              <div>
                <Button
                  variant="danger"
                  busy={pending}
                  disabled={busy || !confirmed}
                  onClick={() => void transfer()}
                >
                  Перенести данные в аккаунт
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
