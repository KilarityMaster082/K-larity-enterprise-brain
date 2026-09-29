// Owner task: EB-50 Ask Brain UI — thumbs up/down with a reason; feeds the evaluation set.
"use client";

import { useState } from "react";

import { sendFeedback } from "@/lib/api";
import { FEEDBACK_REASONS, FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/lib/contracts";

import { Icon } from "@klarity/ui";

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
      <p className="feedback-done" role="status">
        <Icon name="check" size={16} /> Thanks — your feedback goes into the answer-quality review.
      </p>
    );
  }

  return (
    <div className="feedback">
      <span className="feedback-q">Was this answer useful?</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-pressed={rating === "up"}
        onClick={() => {
          setRating("up");
          void send("up", null);
        }}
      >
        <Icon name="thumbUp" size={16} /> Yes
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-pressed={rating === "down"}
        aria-expanded={state === "choosing"}
        onClick={() => {
          setRating("down");
          setState("choosing");
        }}
      >
        <Icon name="thumbDown" size={16} /> No
      </button>

      {state === "choosing" || (rating === "down" && state === "error") ? (
        <form
          className="feedback-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) void send("down", reason);
          }}
        >
          <fieldset>
            <legend>What was wrong?</legend>
            <div className="chips">
              {FEEDBACK_REASONS.map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                  {FEEDBACK_REASON_LABELS[r]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="visually-hidden">Details (optional)</span>
            <textarea
              className="textarea"
              rows={2}
              maxLength={1000}
              placeholder="Details (optional) — e.g. which fact is wrong"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!reason}>
              Send feedback
            </button>
          </div>
        </form>
      ) : null}
      {state === "error" ? (
        <p className="feedback-error" role="alert">
          Couldn&apos;t send feedback. Please try again.
        </p>
      ) : null}
    </div>
  );
}
