const formatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function snapshotPeriod(closedMonth: string): string {
  return formatter.format(new Date(`${closedMonth}-01T12:00:00Z`));
}
