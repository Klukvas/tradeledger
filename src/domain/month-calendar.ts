export type CalendarMonth = Readonly<{ year: number; month: number }>;
export const MONTHLY_TIME_ZONE = "Europe/Kyiv";

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: MONTHLY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date): Readonly<Record<string, number>> {
  return Object.fromEntries(
    calendar
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

export function kyivMonth(date: Date): CalendarMonth {
  const parts = localParts(date);
  return { year: parts.year ?? 0, month: parts.month ?? 0 };
}

export function shiftMonth(
  month: CalendarMonth,
  offset: number,
): CalendarMonth {
  const absolute = month.year * 12 + month.month - 1 + offset;
  return {
    year: Math.floor(absolute / 12),
    month: (((absolute % 12) + 12) % 12) + 1,
  };
}

export function monthKey(month: CalendarMonth): string {
  return `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}`;
}

/** Month starts are unambiguous in Kyiv; resolve the IANA offset, never the host timezone. */
export function monthBoundary(month: CalendarMonth): Date {
  const target = new Date(0);
  target.setUTCFullYear(month.year, month.month - 1, 1);
  target.setUTCHours(0, 0, 0, 0);
  let candidate = target.getTime();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(new Date(candidate));
    const local = new Date(0);
    local.setUTCFullYear(
      parts.year ?? 0,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
    );
    local.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
    const correction = target.getTime() - local.getTime();
    if (correction === 0) return new Date(candidate);
    candidate += correction;
  }
  throw new Error("Could not resolve Kyiv month boundary");
}

export function closingBoundary(closedMonth: string): Date | null {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(closedMonth)) return null;
  const year = Number(closedMonth.slice(0, 4));
  // Intl calendars do not represent ISO year zero; normal ISO years remain clock-free.
  if (year < 1 || year >= 9999) return null;
  try {
    return monthBoundary(
      shiftMonth({ year, month: Number(closedMonth.slice(5)) }, 1),
    );
  } catch {
    return null;
  }
}
