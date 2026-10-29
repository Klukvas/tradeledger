import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../data";
import { AuthScreen, AuthUnavailable } from "./AuthScreen";

function authentication(): AuthContextValue {
  return {
    snapshot: { status: "anonymous" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
}
describe("authentication forms", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "false", "true"])(
    "shows only login even when the old registration flag is %s",
    async (registrationFlag) => {
      vi.stubEnv("VITE_PUBLIC_REGISTRATION", registrationFlag);
      const auth = {
        ...authentication(),
        login: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      };
      const user = userEvent.setup();
      render(<AuthScreen auth={auth} />);
      expect(
        screen.queryByRole("button", { name: "Создать аккаунт" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Вход в TradeLedger" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Доступ предоставляет владелец TradeLedger."),
      ).toBeInTheDocument();
      await user.type(
        screen.getByLabelText("Электронная почта"),
        "owner@example.test",
      );
      await user.type(screen.getByLabelText("Пароль"), "draft-passphrase");
      await user.click(screen.getByRole("button", { name: "Войти" }));
      expect(auth.login).toHaveBeenCalledWith(
        "owner@example.test",
        "draft-passphrase",
      );
      expect(auth.register).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Пароль")).toHaveValue("");
    },
  );

  it("uses bounded native login fields", () => {
    render(<AuthScreen auth={authentication()} />);
    const email = screen.getByLabelText("Электронная почта");
    const password = screen.getByLabelText("Пароль");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("maxlength", "254");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("minlength", "12");
    expect(password).toHaveAttribute("maxlength", "256");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });
  it("rejects a short password, guards duplicate requests and retains email after failure/loading", async () => {
    const auth = authentication();
    let finish:
      | ((value: Awaited<ReturnType<AuthContextValue["login"]>>) => void)
      | undefined;
    const login = vi.fn<AuthContextValue["login"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<AuthScreen auth={{ ...auth, login }} />);
    fireEvent.change(screen.getByLabelText("Электронная почта"), {
      target: { value: "owner@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "short" },
    });
    const form = screen.getByRole("button", { name: "Войти" }).closest("form");
    if (!form) throw new Error("Missing auth form");
    fireEvent.submit(form);
    expect(login).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "draft-passphrase" },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(login).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled();
    view.rerender(
      <AuthScreen auth={{ ...auth, snapshot: { status: "loading" }, login }} />,
    );
    expect(screen.getByLabelText("Электронная почта")).toHaveValue(
      "owner@example.test",
    );
    await act(async () =>
      finish?.({
        ok: false,
        error: { code: "VALIDATION", message: "Неверная почта или пароль." },
      }),
    );
    view.rerender(<AuthScreen auth={{ ...auth, login }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Неверная почта или пароль.",
    );
    expect(screen.getByLabelText("Электронная почта")).toHaveValue(
      "owner@example.test",
    );
  });
  it("retries unavailable sessions without showing credential fields", async () => {
    const user = userEvent.setup();
    const auth = {
      ...authentication(),
      snapshot: { status: "unavailable", message: "Нет соединения" } as const,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    render(<AuthUnavailable auth={auth} />);
    expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Повторить подключение" }),
    );
    expect(auth.refresh).toHaveBeenCalledOnce();
  });
});
