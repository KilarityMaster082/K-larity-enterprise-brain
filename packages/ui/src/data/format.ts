// Owner task: EB-97 Shared data components — Indian number, currency and date formatting.

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN");

function trim(n: number, digits = 2): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

/** 1840000 → "₹18.4 lakh"; 15300000 → "₹1.53 crore"; below 1 lakh → "₹92,500". */
export function formatINRShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} crore`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} lakh`;
  return sign + inr.format(abs);
}

/** Exact value with Indian digit grouping: 1840000 → "₹18,40,000". */
export function formatINR(amount: number): string {
  return (amount < 0 ? "−" : "") + inr.format(Math.abs(amount));
}

export function formatNumber(n: number): string {
  return num.format(n);
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${trim(fraction * 100, digits)}%`;
}

const IST = "Asia/Kolkata";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "3 days ago" / "in 2 days", relative to `now` (default: current time). */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["week", 7 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return "just now";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
