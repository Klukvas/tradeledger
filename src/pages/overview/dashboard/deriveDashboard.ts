import type { Account, InventoryItem, Snapshot } from "../../../domain/types";
import { snapshotPeriod } from "../../shared/snapshotPeriod";

export type MoneyPoint = Readonly<{
  id: string;
  label: string;
  createdAt: string | null;
  totalMinor: number;
  isCurrent: boolean;
}>;

type TrendGeometry = Readonly<{
  minimum: number;
  maximum: number;
  zeroY: number;
  points: readonly (MoneyPoint & Readonly<{ x: number; y: number }>)[];
}>;
type AccountBalanceSummary = Readonly<{
  rows: readonly (Account & Readonly<{ width: number }>)[];
  remainingCount: number;
}>;
type InventoryValueRow = Readonly<{
  id: string;
  name: string;
  detail: string;
  quantity: bigint;
  valueMinor: number;
  isRemainder: boolean;
  width: number;
}>;
type InventoryValueSummary = Readonly<{
  rows: readonly InventoryValueRow[];
  quantity: string;
  withoutStock: number;
  isZeroValue: boolean;
}>;

export function moneyPoints(
  snapshots: readonly Snapshot[],
  currentMinor: number,
): readonly MoneyPoint[] {
  return [
    ...snapshots.slice(-12).map((snapshot) => ({
      id: snapshot.id,
      label: snapshot.closedMonth
        ? `${snapshot.label} · Закрыт месяц: ${snapshotPeriod(snapshot.closedMonth)}`
        : snapshot.label,
      createdAt: snapshot.createdAt,
      totalMinor: snapshot.totalMinor,
      isCurrent: false,
    })),
    {
      id: "current",
      label: "Сейчас",
      createdAt: null,
      totalMinor: currentMinor,
      isCurrent: true,
    },
  ];
}

/** Convert only a bounded ratio to Number, preserving exact subtraction at the money limits. */
export function scaledRatio(
  value: bigint,
  maximum: bigint,
  scale = 100,
): number {
  return maximum === 0n
    ? 0
    : Number((value * BigInt(scale * 1000)) / maximum) / 1000;
}

export function trendGeometry(points: readonly MoneyPoint[]): TrendGeometry {
  const values = points.map((point) => BigInt(point.totalMinor));
  const minimum = values.reduce(
    (lowest, value) => (value < lowest ? value : lowest),
    0n,
  );
  const maximum = values.reduce(
    (highest, value) => (value > highest ? value : highest),
    0n,
  );
  const range = maximum - minimum;
  const y = (value: bigint): number =>
    range === 0n ? 100 : 180 - scaledRatio(value - minimum, range, 160);
  return {
    minimum: Number(minimum),
    maximum: Number(maximum),
    zeroY: y(0n),
    points: points.map((point, index) => ({
      ...point,
      x: points.length <= 1 ? 320 : 24 + (index * 592) / (points.length - 1),
      y: y(BigInt(point.totalMinor)),
    })),
  };
}

const absolute = (value: number): bigint => {
  const exact = BigInt(value);
  return exact < 0n ? -exact : exact;
};

export function accountBalances(
  accounts: readonly Account[],
): AccountBalanceSummary {
  const ranked = accounts
    .map((account, index) => ({ account, index }))
    .sort((left, right) => {
      const leftValue = absolute(left.account.balanceMinor);
      const rightValue = absolute(right.account.balanceMinor);
      return leftValue === rightValue
        ? left.index - right.index
        : leftValue > rightValue
          ? -1
          : 1;
    })
    .slice(0, 5);
  const maximum = ranked.reduce(
    (max, { account }) =>
      absolute(account.balanceMinor) > max
        ? absolute(account.balanceMinor)
        : max,
    0n,
  );
  return {
    rows: ranked.map(({ account }) => ({
      ...account,
      width: scaledRatio(absolute(account.balanceMinor), maximum, 50),
    })),
    remainingCount: Math.max(0, accounts.length - 5),
  };
}

export function inventoryValues(
  inventory: readonly InventoryItem[],
): InventoryValueSummary {
  const ranked = inventory
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        right.item.stockValueMinor - left.item.stockValueMinor ||
        left.index - right.index,
    );
  const top = ranked.slice(0, 5).map(({ item }) => ({
    id: item.id,
    name: item.name,
    detail: `${item.sku} · ${item.quantity} шт.`,
    quantity: BigInt(item.quantity),
    valueMinor: item.stockValueMinor,
    isRemainder: false,
  }));
  const rest = ranked.slice(5);
  const rows =
    rest.length === 0
      ? top
      : [
          ...top,
          {
            id: "remainder",
            name: "Остальные товары",
            detail: `${rest.length} позиций`,
            quantity: rest.reduce(
              (sum, { item }) => sum + BigInt(item.quantity),
              0n,
            ),
            valueMinor: Number(
              rest.reduce(
                (sum, { item }) => sum + BigInt(item.stockValueMinor),
                0n,
              ),
            ),
            isRemainder: true,
          },
        ];
  const maximum = rows.reduce((max, row) => Math.max(max, row.valueMinor), 0);
  return {
    rows: rows.map((row) => ({
      ...row,
      width: scaledRatio(BigInt(row.valueMinor), BigInt(maximum)),
    })),
    quantity: inventory
      .reduce((sum, item) => sum + BigInt(item.quantity), 0n)
      .toString(),
    withoutStock: inventory.filter((item) => item.quantity === 0).length,
    isZeroValue: maximum === 0,
  };
}
