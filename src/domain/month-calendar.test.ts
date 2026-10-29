import { describe, expect, it } from "vitest";
import {
  closingBoundary,
  kyivMonth,
  monthBoundary,
  monthKey,
  shiftMonth,
} from "./month-calendar";

describe("Kyiv month calendar", () => {
  it.each([
    [{ year: 2026, month: 3 }, "2026-02-28T22:00:00.000Z"],
    [{ year: 2026, month: 4 }, "2026-03-31T21:00:00.000Z"],
    [{ year: 2026, month: 10 }, "2026-09-30T21:00:00.000Z"],
    [{ year: 2026, month: 11 }, "2026-10-31T22:00:00.000Z"],
    [{ year: 2027, month: 1 }, "2026-12-31T22:00:00.000Z"],
  ])(
    "resolves midnight independently of server timezone: %j",
    (month, expected) => {
      expect(monthBoundary(month).toISOString()).toBe(expected);
      expect(kyivMonth(new Date(expected))).toEqual(month);
      expect(kyivMonth(new Date(Date.parse(expected) - 1))).toEqual(
        shiftMonth(month, -1),
      );
      expect(
        closingBoundary(monthKey(shiftMonth(month, -1)))?.toISOString(),
      ).toBe(expected);
    },
  );
  it("rejects malformed or noncalendar official markers", () => {
    for (const input of [
      "2026-00",
      "2026-13",
      "26-01",
      "2026-1",
      "0000-01",
      "2026-01x",
    ])
      expect(closingBoundary(input)).toBeNull();
  });
});
