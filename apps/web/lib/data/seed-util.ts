// Owner task: EB-23 Web UI shell — helpers shared by the development seeds.
import type { Evidence, SourceType } from "../contracts";

export function ev(
  id: string,
  sourceType: SourceType,
  title: string,
  excerpt: string,
  quote: string,
  extra: Partial<Evidence> = {},
): Evidence {
  const start = excerpt.indexOf(quote);
  if (start < 0) throw new Error(`evidence ${id}: quote not found`);
  return { id, sourceType, title, excerpt, highlight: { start, end: start + quote.length }, ...extra };
}

/** Timestamp `minutes` ago. Source freshness and member activity are relative to now so they never read as future. */
export const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN").format(n);

