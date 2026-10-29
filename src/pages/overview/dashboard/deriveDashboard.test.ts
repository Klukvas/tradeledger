import { describe, expect, it } from "vitest";
import type { Account, InventoryItem, Snapshot } from "../../../domain/types";
import {
  accountBalances,
  inventoryValues,
  moneyPoints,
  trendGeometry,
} from "./deriveDashboard";

const snapshot = (id: number, totalMinor = id): Snapshot => ({
  id: `s${id}`,
  label: `Замер ${id}`,
  createdAt: "2026-10-01T10:00:00Z",
  totalMinor,
  accounts: [],
});
const account = (id: string, balanceMinor: number): Account => ({
  id,
  name: id,
  owner: "ФОП",
  provider: "MONO",
  balanceMinor,
});
const item = (
  id: string,
  quantity: number,
  stockValueMinor: number,
): InventoryItem => ({ id, sku: id, name: id, quantity, stockValueMinor });

describe("dashboard derivation", () => {
  it("keeps append order, last 12 saved points and a separate current point even at equal totals", () => {
    expect(moneyPoints([], 20)).toEqual([
      {
        id: "current",
        label: "Сейчас",
        createdAt: null,
        totalMinor: 20,
        isCurrent: true,
      },
    ]);
    expect(
      moneyPoints([snapshot(1)], 1).map((point) => point.isCurrent),
    ).toEqual([false, true]);
    const snapshots = Array.from({ length: 13 }, (_, index) =>
      snapshot(index + 1),
    );
    const points = moneyPoints(snapshots, 13);
    expect(points).toHaveLength(13);
    expect(points[0]?.id).toBe("s2");
    expect(points.at(-2)?.id).toBe("s13");
    expect(points.at(-1)?.isCurrent).toBe(true);
    expect(snapshots.map((entry) => entry.id)).toEqual(
      Array.from({ length: 13 }, (_, index) => `s${index + 1}`),
    );
  });
  it.each([
    [0, 0],
    [50, 50],
    [-50, -50],
    [-100, 200],
    [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("keeps finite bounded geometry for %s and %s", (saved, current) => {
    const geometry = trendGeometry(moneyPoints([snapshot(1, saved)], current));
    for (const point of geometry.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.y).toBeGreaterThanOrEqual(20);
      expect(point.y).toBeLessThanOrEqual(180);
    }
    expect(Number.isFinite(geometry.zeroY)).toBe(true);
  });
  it("ranks absolute balances independently of a zero net total and preserves ties without mutation", () => {
    const accounts = Object.freeze([
      account("plus", 100),
      account("minus", -100),
      account("small", 10),
      account("debt", -10),
      account("zero", 0),
      account("last", 0),
    ]);
    const result = accountBalances(accounts);
    expect(result.rows.map((row) => row.id)).toEqual([
      "plus",
      "minus",
      "small",
      "debt",
      "zero",
    ]);
    expect(result.rows.map((row) => row.width)).toEqual([50, 50, 5, 5, 0]);
    expect(result.remainingCount).toBe(1);
    expect(accounts[0]?.id).toBe("plus");
    expect(accountBalances([account("zero", 0)]).rows[0]?.width).toBe(0);
    expect(accountBalances([]).rows).toEqual([]);
  });
  it("combines remaining SKUs and scales every row against the largest shown value", () => {
    const inventory = Object.freeze(
      Array.from({ length: 12 }, (_, index) => item(`sku${index}`, 1, 100)),
    );
    const result = inventoryValues(inventory);
    expect(result.rows.slice(0, 5).map((row) => row.id)).toEqual([
      "sku0",
      "sku1",
      "sku2",
      "sku3",
      "sku4",
    ]);
    expect(result.rows.at(-1)).toMatchObject({
      name: "Остальные товары",
      detail: "7 позиций",
      valueMinor: 700,
      width: 100,
    });
    expect(result.rows[0]?.width).toBeCloseTo(14.285, 3);
    expect(inventory).toHaveLength(12);
  });
  it("retains exact aggregate quantities beyond MAX_SAFE_INTEGER and actual zero-value stock", () => {
    const result = inventoryValues([
      item("a", Number.MAX_SAFE_INTEGER, 0),
      item("b", Number.MAX_SAFE_INTEGER, 0),
      item("empty", 0, 0),
    ]);
    expect(result.quantity).toBe("18014398509481982");
    expect(result.withoutStock).toBe(1);
    expect(result.isZeroValue).toBe(true);
    expect(result.rows.every((row) => row.width === 0)).toBe(true);
    expect(inventoryValues([])).toMatchObject({
      rows: [],
      quantity: "0",
      withoutStock: 0,
    });
  });
});
