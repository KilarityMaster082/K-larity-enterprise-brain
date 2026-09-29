// Owner task: EB-50 Ask Brain UI — answer feedback. Production writes to the evaluation table
// (services/evaluation); in development it is only validated and acknowledged.
import { NextResponse } from "next/server";

import { FEEDBACK_REASONS } from "@/lib/contracts";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let body: { question?: unknown; rating?: unknown; reason?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  const reason = FEEDBACK_REASONS.find((r) => r === body.reason) ?? null;
  if (!rating || (rating === "down" && !reason)) {
    return NextResponse.json({ error: "rating (and a reason for 'down') required" }, { status: 400 });
  }
  const comment = typeof body.comment === "string" ? body.comment.slice(0, 1000) : "";
  return NextResponse.json({ ok: true, stored: false, rating, reason, commentLength: comment.length });
}
