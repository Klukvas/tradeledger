import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { readLegacyLedger, type LegacyLedger } from "../data";
import type { LedgerState } from "../domain/types";

type LegacySource = Readonly<{
  source: LegacyLedger | null;
  error: string;
  loading: boolean;
  retry: () => void;
}>;
const LegacyContext = createContext<LegacySource>({
  source: null,
  error: "",
  loading: false,
  retry: () => undefined,
});
export function hasRecords(state: LedgerState): boolean {
  return Object.values(state).some((records) => records.length > 0);
}
export function LegacyProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [source, setSource] = useState<LegacyLedger | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const reading = useRef(false);
  useEffect(() => {
    let active = true;
    reading.current = true;
    void readLegacyLedger()
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setSource(result.value);
          setError("");
        } else setError(result.error.message);
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось проверить прежние локальные данные. Повторите чтение.",
          );
      })
      .finally(() => {
        if (active) {
          reading.current = false;
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  function retry(): void {
    if (reading.current) return;
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  return (
    <LegacyContext.Provider value={{ source, error, loading, retry }}>
      {children}
    </LegacyContext.Provider>
  );
}
export function useLegacySource(): LegacySource {
  return useContext(LegacyContext);
}
export function LegacyNotice(): ReactElement | null {
  const { source, error } = useLegacySource();
  if (
    !error &&
    source?.status !== "corrupt" &&
    !(source?.status === "ready" && hasRecords(source.document.state))
  )
    return null;
  return (
    <section
      className="notice legacy-notice"
      aria-label="Прежние локальные данные"
    >
      <p>
        {source?.status === "ready"
          ? "В этом браузере найдены прежние записи. Можно проверить и перенести их в текущий аккаунт."
          : "Прежние локальные данные требуют проверки. Исходная копия сохранена."}{" "}
        <a href="#settings">Проверить перенос</a>
      </p>
    </section>
  );
}
