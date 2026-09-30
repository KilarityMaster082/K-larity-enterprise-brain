// Owner task: EB-23 Web UI shell — the reporting period control (Today / This Week / This Month / Reports).
// It is a URL parameter so every view is shareable and server-rendered; only screens that have a time window use it.
export type PeriodKey = "today" | "week" | "month" | "reports";

export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "This Week", days: 7 },
  { key: "month", label: "This Month", days: 30 },
  { key: "reports", label: "Reports", days: 365 },
];

/** Screens that show a time window. The control is not drawn elsewhere, so it is never a dead control. */
export const PERIOD_ROUTES = ["/executive", "/finance", "/projects", "/activity", "/history", "/explore", "/todos"];

export function parsePeriod(v: string | undefined): PeriodKey {
  return PERIODS.some((p) => p.key === v) ? (v as PeriodKey) : "month";
}

export function periodDays(key: PeriodKey): number {
  return PERIODS.find((p) => p.key === key)!.days;
}
