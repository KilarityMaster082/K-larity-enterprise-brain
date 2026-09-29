// Owner task: EB-23 Web UI shell — typed client for the web app's API routes.
import type { FeedbackReason } from "./contracts";
import type { StreamEvent } from "./ask/stream";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, detail?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Stream an answer: yields events until `done` or `error`. Abort with the signal to stop. */
export async function* askStream(question: string, projectId: string | undefined, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, projectId }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, detail?.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finished = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent;
      if (ev.type === "done" || ev.type === "error") finished = true;
      yield ev;
    }
  }
  if (!finished) throw new ApiError(0, "the connection dropped before the answer was complete");
}

export function sendFeedback(input: { question: string; rating: "up" | "down"; reason: FeedbackReason | null; comment: string }): Promise<{ ok: boolean }> {
  return post("/api/feedback", input);
}
