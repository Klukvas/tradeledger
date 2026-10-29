import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Field, MoneyInput, StatCard } from "./primitives";

afterEach(cleanup);

describe("Field", () => {
  it("associates a direct money control with its label, hint and validation error", () => {
    render(
      <>
        <p id="existing-help">Ручной ввод</p>
        <Field
          label="Остаток"
          htmlFor="balance"
          hint="В гривнах"
          error="Проверьте сумму"
        >
          <MoneyInput value="12,50" readOnly aria-describedby="existing-help" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText("Остаток");
    expect(input).toHaveAttribute("id", "balance");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Ручной ввод В гривнах Проверьте сумму",
    );
    expect(document.querySelectorAll("#balance")).toHaveLength(1);
  });

  it("rejects wrapped controls instead of silently assigning duplicate IDs", () => {
    expect(() =>
      renderToStaticMarkup(
        <Field label="Остаток" htmlFor="balance" error="Проверьте сумму">
          <div>
            <input id="balance" />
          </div>
        </Field>,
      ),
    ).toThrow(
      "Field requires a direct input, select, textarea or MoneyInput child",
    );
  });
});

describe("StatCard", () => {
  it("keeps long money values wrappable after the full stylesheet cascade", () => {
    const style = document.createElement("style");
    const componentStyles = readFileSync(
      resolve(process.cwd(), "src/ui/components.css"),
      "utf8",
    );
    const globalStyles = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    const globals = globalStyles
      .replace('@import "./ui/components.css";', "")
      .replace('@charset "UTF-8";', "");
    style.textContent = componentStyles + globals;
    document.head.append(style);
    try {
      render(
        <StatCard label="Общий остаток" value="90 071 992 547 409,91 ₴" />,
      );
      const amount = screen.getByText("90 071 992 547 409,91 ₴");
      expect(getComputedStyle(amount).whiteSpace).toBe("normal");
      expect(getComputedStyle(amount).overflowWrap).toBe("anywhere");
    } finally {
      style.remove();
    }
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
