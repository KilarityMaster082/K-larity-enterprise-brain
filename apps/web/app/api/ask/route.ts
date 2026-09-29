// Owner task: EB-96 Streaming answers — /api/ask streams the answer contract as NDJSON.
// Development: answers come from the dev engine over this tenant's data. Production: this route will call the
// context engine through apps/api with the caller's token; the stream format stays the same.
import { answerQuestion } from "@/lib/ask/engine";
import { eventsFor } from "@/lib/ask/stream";
import { authMode } from "@/lib/auth/config";
import { activeMembership, getSession } from "@/lib/auth/session";
import { markAskedFirstQuestion, tenantView } from "@/lib/data/store";
import { can } from "@/lib/permissions";

const MAX_QUESTION = 2000;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  const m = activeMembership(session);
  if (!can(m.role, "ask")) return json({ error: "forbidden" }, 403);
  if (authMode() !== "dev") return json({ error: "the context engine is not connected in this environment" }, 503);

  let question = "";
  let projectId: string | undefined;
  try {
    const body = (await req.json()) as { question?: unknown; projectId?: unknown };
    question = typeof body.question === "string" ? body.question.trim() : "";
    projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!question || question.length > MAX_QUESTION) return json({ error: `question must be 1–${MAX_QUESTION} characters` }, 400);

  const view = tenantView(m.tenantId, m.slug);
  const contract = answerQuestion(question, view.data, {
    projectId,
    canSeeFinance: can(m.role, "finance.view"),
    hasSyncedSource: view.hasSyncedSource,
  });
  if (view.hasSyncedSource) markAskedFirstQuestion(m.tenantId, m.slug);

  const enc = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      try {
        await wait(350); // simulated retrieval so progress is visible in development
        for (const ev of eventsFor(contract)) {
          if (signal.aborted) break;
          controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
          await wait(ev.type === "segment" ? 180 : ev.type === "stage" ? 350 : 90);
        }
      } catch {
        try {
          controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: "the answer could not be completed" }) + "\n"));
        } catch {
          // stream already closed
        }
      } finally {
        try {
          controller.close();
        } catch {
          // client already went away
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
