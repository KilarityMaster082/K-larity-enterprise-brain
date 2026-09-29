// Owner task: EB-50 Ask Brain UI — /api/ask. In development it answers from DEMO fixtures; in production
// it will proxy to the context engine (apps/api) with the caller's token. Tenant comes from the session.
import { NextResponse } from "next/server";

import { demoAnswer } from "@/lib/fixtures/answers";
import { activeMembership, authMode, getSession } from "@/lib/session";

const MAX_QUESTION = 2000;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (authMode() !== "dev") {
    return NextResponse.json({ error: "context engine not connected" }, { status: 503 });
  }

  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!question || question.length > MAX_QUESTION) {
    return NextResponse.json({ error: `question must be 1–${MAX_QUESTION} characters` }, { status: 400 });
  }

  await new Promise((r) => setTimeout(r, 1400)); // simulate retrieval latency so loading states are visible
  return NextResponse.json(demoAnswer(question, activeMembership(session).slug));
}
