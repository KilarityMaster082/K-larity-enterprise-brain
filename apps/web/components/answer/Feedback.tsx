"use client";
// Owner task: EB-50 Ask Brain UI — "Useful / Not useful" with a reason; feeds the evaluation set.
import { Icon, Pill, PillButton } from "@klarity/ui";
import { useState } from "react";

import { sendFeedback } from "@/lib/api";
import { FEEDBACK_REASONS, FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/lib/contracts";

type State = "idle" | "choosing" | "sending" | "sent" | "error";

export function Feedback({ question }: { question: string }) {
  const [state, setState] = useState<State>("idle");
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [comment, setComment] = useState("");

  async function send(r: "up" | "down", why: FeedbackReason | null) {
    setState("sending");
    try {
      await sendFeedback({ question, rating: r, reason: why, comment });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="eb-note" role="status">
        <Icon name="check" size={13} /> Thanks — your feedback goes into the answer-quality review.
      </p>
    );
  }

  return (
    <div className="eb-stack tight">
      <div className="eb-row">
        <PillButton
          tone="outline"
          aria-pressed={rating === "up"}
          onClick={() => {
            setRating("up");
            void send("up", null);
          }}
        >
          <Icon name="thumbUp" size={13} /> Useful
        </PillButton>
        <PillButton
          tone="outline"
          aria-pressed={rating === "down"}
          aria-expanded={state === "choosing"}
          onClick={() => {
            setRating("down");
            setState("choosing");
          }}
        >
          <Icon name="thumbDown" size={13} /> Not useful
        </PillButton>
      </div>
      {state === "choosing" || (rating === "down" && state === "error") ? (
        <form
          className="eb-stack tight"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) void send("down", reason);
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eb-h" style={{ marginBottom: 6 }}>
              What was wrong?
            </legend>
            <div className="eb-row">
              {FEEDBACK_REASONS.map((r) => (
                <PillButton key={r} tone={reason === r ? "black" : "glass"} aria-pressed={reason === r} onClick={() => setReason(r)}>
                  {FEEDBACK_REASON_LABELS[r]}
                </PillButton>
              ))}
            </div>
          </fieldset>
          <label className="eb-label">
            <span className="visually-hidden">Details (optional)</span>
            <textarea className="eb-input" rows={2} maxLength={1000} placeholder="Details (optional) — e.g. which fact is wrong" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div>
            <PillButton type="submit" tone="black" disabled={!reason}>
              Send feedback
            </PillButton>
          </div>
        </form>
      ) : null}
      {state === "error" ? (
        <p className="eb-note eb-danger" role="alert">
          <Pill tone="pink">Couldn&apos;t send feedback</Pill> Please try again.
        </p>
      ) : null}
    </div>
  );
}
