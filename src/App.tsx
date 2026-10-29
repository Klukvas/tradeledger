import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { useAuth, useLedger, type PublicUser } from "./data";
import { AuthScreen, AuthUnavailable } from "./auth/AuthScreen";
import { LegacyProvider, LegacyNotice } from "./auth/LegacySource";
import type { Failure } from "./domain/types";
import { AccountsPage } from "./pages/AccountsPage";
import { DebtsPage } from "./pages/DebtsPage";
import { HistoryPage, type HistoryFilters } from "./pages/HistoryPage";
import { InventoryPage } from "./pages/InventoryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Button, InlineError, PageHeader } from "./ui";

const destinations = [
  {
    route: "overview",
    label: "Обзор",
    icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  },
  {
    route: "inventory",
    label: "Склад",
    icon: "m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  },
  { route: "accounts", label: "Счета", icon: "M3 5h18v14H3z M3 10h18 M7 15h4" },
  { route: "debts", label: "Долги", icon: "M4 7h15l-4-4 M20 17H5l4 4" },
  {
    route: "history",
    label: "История",
    icon: "M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2",
  },
] as const;
type Route = (typeof destinations)[number]["route"] | "settings";
const sidebarPreferenceKey = "tradeledger.sidebar-collapsed";

function readSidebarPreference(): boolean {
  try {
    return window.localStorage.getItem(sidebarPreferenceKey) === "true";
  } catch {
    // A blocked preference store must not prevent opening the ledger.
    return false;
  }
}

function currentRoute(): Route {
  const hash = window.location.hash.slice(1);
  if (hash === "settings") return "settings";
  return destinations.find(({ route }) => route === hash)?.route ?? "overview";
}

function subscribeToRoute(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

function NavigationIcon({ path }: { path: string }): ReactElement {
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </span>
  );
}

function Navigation({
  route,
  collapsed,
  onToggle,
  user,
  logout,
  signingOut,
}: {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
  user: PublicUser;
  logout: () => void;
  signingOut: boolean;
}): ReactElement {
  const toggleLabel = collapsed ? "Развернуть панель" : "Свернуть панель";
  return (
    <aside className="sidebar" aria-label="Боковая панель">
      <div className="sidebar-heading">
        <div className="sidebar-brand">
          <a
            className="brand"
            href="#overview"
            aria-label="TradeLedger — обзор"
          >
            <span className="brand-mark" aria-hidden="true">
              T
            </span>
            <span className="sidebar-label">TradeLedger</span>
          </a>
          <p className="brand-subtitle">Учёт торговли</p>
        </div>
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls="sidebar-navigation"
          onClick={onToggle}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
          </svg>
          <span className="sidebar-tooltip" aria-hidden="true">
            {toggleLabel}
          </span>
        </button>
      </div>
      <nav
        className="sidebar-nav"
        id="sidebar-navigation"
        aria-label="Разделы учёта"
      >
        {destinations.map((destination) => (
          <a
            key={destination.route}
            className="nav-item"
            href={`#${destination.route}`}
            aria-label={destination.label}
            aria-current={route === destination.route ? "page" : undefined}
          >
            <NavigationIcon path={destination.icon} />
            <span className="sidebar-label">{destination.label}</span>
            <span className="sidebar-tooltip" aria-hidden="true">
              {destination.label}
            </span>
          </a>
        ))}
      </nav>
      <div
        className="sidebar-account"
        role="group"
        aria-label="Текущий аккаунт"
      >
        <div
          className="account-email"
          role="group"
          tabIndex={0}
          aria-label={user.email}
        >
          <NavigationIcon path="M20 21v-2a7 7 0 0 0-14 0v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8" />
          <span className="sidebar-label">{user.email}</span>
          <span className="sidebar-tooltip" aria-hidden="true">
            {user.email}
          </span>
        </div>
        <Button
          className="sidebar-logout nav-item"
          variant="secondary"
          aria-label="Выйти"
          busy={signingOut}
          onClick={logout}
        >
          <NavigationIcon path="M9 21H4V3h5 M14 7l5 5-5 5 M8 12h13" />
          <span className="sidebar-label">Выйти</span>
          <span className="sidebar-tooltip" aria-hidden="true">
            Выйти
          </span>
        </Button>
      </div>
    </aside>
  );
}

function RoutePage({
  route,
  email,
  historyFilters,
  onHistoryFiltersChange,
}: {
  route: Route;
  email: string;
  historyFilters: HistoryFilters;
  onHistoryFiltersChange: (filters: HistoryFilters) => void;
}): ReactElement {
  switch (route) {
    case "inventory":
      return <InventoryPage />;
    case "accounts":
      return <AccountsPage />;
    case "debts":
      return <DebtsPage />;
    case "history":
      return (
        <HistoryPage
          filters={historyFilters}
          onFiltersChange={onHistoryFiltersChange}
        />
      );
    case "settings":
      return <SettingsPage email={email} />;
    default:
      return <OverviewPage />;
  }
}

function LoadingPage({ title }: { title: string }): ReactElement {
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowSkeleton(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  const block: CSSProperties = {
    background: "var(--bg-raised)",
    borderRadius: 4,
    height: 18,
  };
  return (
    <div className="page" aria-busy="true">
      <PageHeader title={title} description="Открываем данные с сервера…" />
      <div
        className="panel stack"
        aria-hidden="true"
        style={{ visibility: showSkeleton ? "visible" : "hidden" }}
      >
        <div style={{ ...block, width: "35%" }} />
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 2fr",
              gap: 16,
              minHeight: 48,
              alignItems: "center",
            }}
          >
            <span style={block} />
            <span style={block} />
            <span style={block} />
          </div>
        ))}
      </div>
      <p className="text-muted" role="status">
        Загружаем записи вашего аккаунта.
      </p>
    </div>
  );
}

function RefreshAction({
  refresh,
  disabled = false,
}: {
  refresh: () => Promise<void>;
  disabled?: boolean;
}): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const retry = async (): Promise<void> => {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await refresh();
    } catch {
      setError("Не удалось открыть данные. Повторите попытку позже.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <div className="stack">
      <div>
        <Button
          variant="secondary"
          busy={pending}
          disabled={disabled}
          onClick={() => void retry()}
        >
          Повторить чтение
        </Button>
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}

function RecoveryDownload({ rawBackup }: { rawBackup: string }): ReactElement {
  const [error, setError] = useState("");
  const download = (): void => {
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(
        new Blob([rawBackup], { type: "text/plain;charset=utf-8" }),
      );
      link.href = url;
      link.download = `tradeledger-recovery-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.append(link);
      link.click();
      setError("");
    } catch {
      setError("Не удалось скачать исходные данные. Попробуйте ещё раз.");
    } finally {
      link.remove();
      if (url) URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="stack">
      <div>
        <Button variant="secondary" onClick={download}>
          Скачать исходные данные
        </Button>
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}

function BlockedPage({
  error,
  rawBackup,
  refresh,
}: {
  error: Failure;
  rawBackup: string | null;
  refresh: () => Promise<void>;
}): ReactElement {
  const description =
    error.code === "UNSUPPORTED_VERSION"
      ? "Эти данные созданы в другой версии приложения. Чтобы сохранить их, скачайте исходные данные, если кнопка доступна."
      : error.code === "CORRUPT"
        ? "Не удалось проверить сохранённые записи. Скачайте исходные данные, если кнопка доступна, и сохраните файл для восстановления."
        : "Не удалось получить записи с сервера. Проверьте соединение и повторите чтение.";
  return (
    <div className="page">
      <PageHeader
        title="Данные недоступны"
        description="Изменения временно заблокированы, чтобы сохранить ваши записи."
      />
      <section className="panel stack" aria-label="Восстановление доступа">
        <InlineError message={description} />
        <p className="text-muted">
          Приложение не сбрасывает записи автоматически. Повторите подключение к
          серверу, чтобы продолжить работу.
        </p>
        {typeof rawBackup === "string" && rawBackup.length > 0 && (
          <RecoveryDownload rawBackup={rawBackup} />
        )}
        <RefreshAction refresh={refresh} />
      </section>
    </div>
  );
}

function ReadyError({
  error,
  refresh,
  busy,
}: {
  error: Failure;
  refresh: () => Promise<void>;
  busy: boolean;
}): ReactElement {
  const message =
    error.code === "CONFLICT"
      ? "Данные изменились в другой вкладке или на другом устройстве. Проверьте текущие значения перед повторным сохранением."
      : error.code === "STORAGE"
        ? "Не удалось прочитать или сохранить изменения. Проверьте записи и повторите действие."
        : "Действие не выполнено. Проверьте введённые значения и сообщение в форме.";
  return (
    <section
      className="panel stack"
      aria-label="Последнее действие не выполнено"
    >
      <InlineError message={message} />
      <RefreshAction refresh={refresh} disabled={busy} />
    </section>
  );
}

function LedgerApp({
  user,
  logout,
  signingOut,
}: {
  user: PublicUser;
  logout: () => void;
  signingOut: boolean;
}): ReactElement {
  const route = useSyncExternalStore(subscribeToRoute, currentRoute);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({
    search: "",
    type: "",
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readSidebarPreference,
  );
  const toggleSidebar = (): void => {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(sidebarPreferenceKey, String(nextCollapsed));
    } catch {
      // Keep the toggle usable for this session when storage is unavailable.
    }
  };
  const { snapshot, refresh } = useLedger();
  const mainRef = useRef<HTMLElement>(null);
  const title =
    route === "settings"
      ? "Резервная копия"
      : (destinations.find((destination) => destination.route === route)
          ?.label ?? "Обзор");
  useEffect(() => {
    document.title = `${title} · TradeLedger`;
  }, [title]);
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      <Navigation
        route={route}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        user={user}
        logout={logout}
        signingOut={signingOut}
      />
      <main
        className="main-content"
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
      >
        <LegacyNotice />
        {snapshot.status === "loading" ? (
          <LoadingPage title={title} />
        ) : snapshot.status === "blocked" ? (
          <BlockedPage
            error={snapshot.error}
            rawBackup={snapshot.rawBackup}
            refresh={refresh}
          />
        ) : (
          <div className="stack">
            {snapshot.error && (
              <ReadyError
                error={snapshot.error}
                refresh={refresh}
                busy={snapshot.busy}
              />
            )}
            <RoutePage
              key={route}
              route={route}
              email={user.email}
              historyFilters={historyFilters}
              onHistoryFiltersChange={setHistoryFilters}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export function App(): ReactElement {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const logoutPending = useRef(false);
  async function logout(): Promise<void> {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setSigningOut(true);
    try {
      await auth.logout();
    } finally {
      logoutPending.current = false;
      setSigningOut(false);
    }
  }
  if (auth.snapshot.status === "authenticated") {
    return (
      <LegacyProvider key={auth.snapshot.user.id}>
        <LedgerApp
          user={auth.snapshot.user}
          logout={() => void logout()}
          signingOut={signingOut}
        />
      </LegacyProvider>
    );
  }
  if (auth.snapshot.status === "unavailable")
    return <AuthUnavailable auth={auth} />;
  return <AuthScreen auth={auth} signingOut={signingOut} />;
}

/** A render failure must never reset saved records. */
export class ApplicationErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="main-content">
        <div className="page">
          <PageHeader
            title="Не удалось открыть приложение"
            description="Сохранённые записи не удалены. Перезагрузите страницу и попробуйте снова."
          />
          <Button onClick={() => window.location.reload()}>
            Перезагрузить страницу
          </Button>
        </div>
      </main>
    );
  }
}
