// Owner task: EB-23 Web UI shell — typed client for the web app's API routes.
import type { AnswerContract, FeedbackReason } from "./contracts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, detail?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function askBrain(question: string): Promise<AnswerContract> {
  return post<AnswerContract>("/api/ask", { question });
}

export function sendFeedback(input: {
  question: string;
  rating: "up" | "down";
  reason: FeedbackReason | null;
  comment: string;
}): Promise<{ ok: boolean }> {
  return post("/api/feedback", input);
}
