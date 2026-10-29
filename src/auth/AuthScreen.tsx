import { useRef, useState, type FormEvent, type ReactElement } from "react";
import type { AuthContextValue } from "../data";
import { Button, Field, InlineError, PageHeader } from "../ui";
import "./auth.css";

export function AuthScreen({
  auth,
  signingOut = false,
}: {
  auth: AuthContextValue;
  signingOut?: boolean;
}): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = pending || signingOut;
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pendingRef.current || busy || !event.currentTarget.reportValidity())
      return;
    if (password.length < 12 || password.length > 256) {
      setError("Пароль должен содержать от 12 до 256 символов.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const result = await auth.login(email.trim(), password);
      if (result.ok) setPassword("");
      else setError(result.error.message);
    } catch {
      setError("Не удалось связаться с сервером. Повторите попытку.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  if (auth.snapshot.status === "loading" && !pending) return <AuthLoading />;
  const message =
    auth.snapshot.status === "anonymous"
      ? auth.snapshot.message
      : undefined;
  return (
    <main className="auth-shell">
      <section className="panel stack auth-card" aria-busy={busy}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          TradeLedger
        </div>
        <PageHeader
          title="Вход в TradeLedger"
          description="Ваш учёт хранится на сервере и доступен после входа в аккаунт."
        />
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <Field label="Электронная почта">
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Пароль" hint="От 12 до 256 символов.">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={256}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {(error || message) && (
            <InlineError message={error || message || ""} />
          )}
          {signingOut && <p role="status">Завершаем сеанс…</p>}
          <Button type="submit" busy={pending} disabled={busy}>
            Войти
          </Button>
        </form>
        <p className="text-small text-muted">
          Доступ предоставляет владелец TradeLedger.
        </p>
        <p className="text-small text-muted">
          Счета и остатки обновляются вручную. Подключение к банкам не
          требуется.
        </p>
      </section>
    </main>
  );
}

export function AuthLoading(): ReactElement {
  return (
    <main className="auth-shell" aria-busy="true">
      <section className="panel stack auth-card">
        <div className="brand">TradeLedger</div>
        <h1>Открываем TradeLedger</h1>
        <p role="status">Проверяем сеанс на сервере…</p>
        <div className="auth-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    </main>
  );
}

export function AuthUnavailable({
  auth,
}: {
  auth: AuthContextValue;
}): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  async function retry(): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await auth.refresh();
    } catch {
      setError("Сервер пока недоступен. Повторите попытку позже.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <main className="auth-shell">
      <section className="panel stack auth-card">
        <PageHeader
          title="Сервер недоступен"
          description="Не удалось проверить сеанс. Проверьте соединение и повторите попытку."
        />
        <InlineError
          message={
            error ||
            (auth.snapshot.status === "unavailable"
              ? auth.snapshot.message
              : "Сервер не ответил.")
          }
        />
        <Button busy={pending} onClick={() => void retry()}>
          Повторить подключение
        </Button>
      </section>
    </main>
  );
}
