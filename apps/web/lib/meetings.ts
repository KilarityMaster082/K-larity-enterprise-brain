// Owner task: EB-105 Meetings and live notes — pure helpers for the calendar week, flagged lines and keywords. Everything
// here works on data the tenant already has (meetings, transcript lines); none of it calls out to a calendar or a model.
import type { Meeting } from "./data/types";

const DAY = 864e5;
const IST = "Asia/Kolkata";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);

/** Monday (IST) of the week containing `d`, as YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const key = dayKey(d);
  const dow = new Date(`${key}T12:00:00+05:30`).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return dayKey(new Date(new Date(`${key}T12:00:00+05:30`).getTime() - back * DAY));
}

export function addDays(key: string, n: number): string {
  return dayKey(new Date(new Date(`${key}T12:00:00+05:30`).getTime() + n * DAY));
}

export function weekDays(monday: string): { key: string; label: string }[] {
  return Array.from({ length: 5 }, (_, i) => {
    const key = addDays(monday, i);
    const d = new Date(`${key}T12:00:00+05:30`);
    const wd = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: IST }).format(d).toUpperCase();
    const dd = new Intl.DateTimeFormat("en-IN", { day: "2-digit", timeZone: IST }).format(d);
    return { key, label: `${wd} ${dd}` };
  });
}

export function parseWeek(v: string | undefined, fallback: Date): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00+05:30`).getTime()) ? mondayOf(new Date(`${v}T12:00:00+05:30`)) : mondayOf(fallback);
}

export function meetingsOn(meetings: Meeting[], key: string): Meeting[] {
  return meetings.filter((m) => dayKey(new Date(m.startsAt)) === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST }).format(new Date(iso));
}

export function nextUp(meetings: Meeting[], now: Date): Meeting | undefined {
  const live = meetings.find((m) => m.status === "live");
  if (live) return live;
  return meetings.filter((m) => m.status === "upcoming" && new Date(m.startsAt).getTime() >= now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

/** "in 40 min", "in 2 days", "now". */
export function startsIn(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "now";
  const min = Math.round(ms / 6e4);
  if (min < 90) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `in ${h} h`;
  return `in ${Math.round(ms / DAY)} days`;
}

/** Keywords worth a chip: rupee amounts, equipment and section codes, dates and capitalised names, most repeated first. */
export function extractKeywords(lines: { text: string }[], limit = 6): string[] {
  const counts = new Map<string, number>();
  const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const { text } of lines) {
    for (const m of text.matchAll(/₹\s?[\d,.]+(?:\s?(?:lakh|crore|L|Cr))?/g)) add(m[0].replace(/\s+/g, " "));
    for (const m of text.matchAll(/\b[A-Z]{2,}(?:\s?\d+)?\b/g)) add(m[0]);
    for (const m of text.matchAll(/\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g)) add(m[0]);
    for (const m of text.matchAll(/\b(?:fire damper|fire NOC|curtain wall|handover|snags?|emergency lighting|DB labelling|fabrication)\b/gi)) add(m[0].toLowerCase());
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k]) => k);
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
