// Owner task: EB-88 Tenant admin console — plan names (safe to import in client components; no tenant data).
export const PLANS = ["pilot", "starter", "business", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

import type { Tone } from "@klarity/ui";

export const STATUS_TONE: Record<string, Tone> = { active: "ok", provisioning: "info", suspended: "danger", offboarding: "warn", offboarded: "neutral" };

export const STATUS_PILL: Record<string, "green" | "sky" | "pink" | "cream" | "outline"> = { active: "green", provisioning: "sky", suspended: "pink", offboarding: "cream", offboarded: "outline" };
