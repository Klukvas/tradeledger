import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../data";
import { createDocument } from "../test/fixtures";
import { App } from "../App";

let auth: AuthContextValue;
const useLedger = vi.fn();
vi.mock("../data", () => ({
  useAuth: () => auth,
  useLedger: () => useLedger(),
  readLegacyLedger: async () => ({ ok: true, value: { status: "absent" } }),
}));
vi.mock("../pages/OverviewPage", () => ({
  OverviewPage: function Overview() {
    const [draft, setDraft] = useState("");
    return (
      <label>
        Приватный черновик
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
    );
  },
}));
vi.mock("../pages/SettingsPage", () => ({
  SettingsPage: () => <p>Настройки</p>,
}));
beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#overview";
  auth = {
    snapshot: { status: "anonymous" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn().mockResolvedValue({ ok: true, value: null }),
    refresh: vi.fn(),
  };
  useLedger.mockReset().mockReturnValue({
    snapshot: {
      status: "ready",
      document: createDocument(),
      busy: false,
      error: null,
    },
    refresh: vi.fn(),
  });
});
describe("session gate", () => {
  it("never reads private ledger or renders navigation before authentication", () => {
    const view = render(<App />);
    expect(useLedger).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    auth = { ...auth, snapshot: { status: "loading" } };
    view.rerender(<App />);
    expect(useLedger).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Проверяем сеанс");
  });
  it("unmounts private drafts on user change and keeps logout in the sidebar account area", () => {
    auth = {
      ...auth,
      snapshot: {
        status: "authenticated",
        user: { id: "owner-a", email: "a@example.test" },
      },
    };
    const view = render(<App />);
    fireEvent.change(screen.getByLabelText("Приватный черновик"), {
      target: { value: "private-a" },
    });
    const logout = screen.getByRole("button", { name: "Выйти" });
    expect(logout.closest(".sidebar-footer")).toBeNull();
    expect(logout.closest(".sidebar-account")).not.toBeNull();
    expect(logout.closest(".sidebar")).not.toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveLength(1);
    auth = {
      ...auth,
      snapshot: {
        status: "authenticated",
        user: { id: "owner-b", email: "b@example.test" },
      },
    };
    view.rerender(<App />);
    expect(screen.getByLabelText("Приватный черновик")).toHaveValue("");
    expect(screen.queryByText("a@example.test")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    expect(auth.logout).toHaveBeenCalledOnce();
    auth = { ...auth, snapshot: { status: "anonymous" } };
    view.rerender(<App />);
    expect(
      screen.queryByLabelText("Приватный черновик"),
    ).not.toBeInTheDocument();
  });
});

describe("sidebar", () => {
  beforeEach(() => {
    auth = {
      ...auth,
      snapshot: {
        status: "authenticated",
        user: { id: "sidebar-owner", email: "owner@example.test" },
      },
    };
  });

  it("remembers the collapsed preference without remounting private drafts", () => {
    const view = render(<App />);
    fireEvent.change(screen.getByLabelText("Приватный черновик"), {
      target: { value: "keep my draft" },
    });
    expect(document.querySelector(".sidebar-footer")).toBeNull();
    expect(
      screen.queryByText("Данные хранятся на сервере."),
    ).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Свернуть панель" });
    expect(toggle).toHaveAttribute("aria-controls", "sidebar-navigation");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "Развернуть панель" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Приватный черновик")).toHaveValue(
      "keep my draft",
    );
    expect(screen.getByRole("navigation").querySelectorAll("a")).toHaveLength(
      5,
    );
    expect(
      screen.queryByRole("link", { name: "Резервная копия" }),
    ).not.toBeInTheDocument();
    view.unmount();
    render(<App />);
    expect(
      screen.getByRole("button", { name: "Развернуть панель" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the direct backup route available without a menu entry", () => {
    window.location.hash = "#settings";
    render(<App />);
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(document.title).toBe("Резервная копия · TradeLedger");
    expect(
      screen.queryByRole("link", { name: "Резервная копия" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the toggle usable when local preferences cannot be read or saved", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked storage");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked storage");
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Свернуть панель" }));
    expect(
      screen.getByRole("button", { name: "Развернуть панель" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Развернуть панель" }));
    expect(
      screen.getByRole("button", { name: "Свернуть панель" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
