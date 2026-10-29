import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

// jsdom has no native dialog implementation. Focus trapping needs a real browser check.
const modalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  if (modalDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      modalDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("Dialog", () => {
  it("preserves the entered draft and focus when a save error is displayed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open title="Счёт" onClose={onClose}>
        <input aria-label="Название" defaultValue="" />
      </Dialog>,
    );
    const input = screen.getByRole("textbox", { name: "Название" });
    await user.type(input, "Основной счёт");
    rerender(
      <Dialog open title="Счёт" onClose={onClose}>
        <input aria-label="Название" defaultValue="" />
        <p role="alert">Не удалось сохранить</p>
      </Dialog>,
    );
    expect(input).toHaveValue("Основной счёт");
    expect(input).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to the trigger on controlled close and keeps the draft mounted", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = (open: boolean) => (
      <>
        <button>Изменить</button>
        <Dialog open={open} title="Счёт" onClose={onClose}>
          <input aria-label="Название" defaultValue="" />
        </Dialog>
      </>
    );
    const { rerender } = render(view(false));
    const trigger = screen.getByRole("button", { name: "Изменить" });
    trigger.focus();
    rerender(view(true));
    const input = screen.getByRole("textbox", { name: "Название" });
    await user.type(input, "Сохранить черновик");
    rerender(view(false));
    expect(trigger).toHaveFocus();
    rerender(view(true));
    expect(screen.getByRole("textbox")).toHaveValue("Сохранить черновик");
  });

  it("delegates Escape to the controlled close handler and labels the modal", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        title="Изменить остаток"
        description="Введите сумму"
        onClose={onClose}
      >
        <input aria-label="Остаток" />
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Изменить остаток" });
    const event = new Event("cancel", { cancelable: true });
    fireEvent(dialog, event);
    expect(onClose).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(dialog).toHaveAccessibleDescription("Введите сумму");
  });
});
