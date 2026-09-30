"use client";
// Owner task: EB-105 Meetings and live notes — the live notes surface: recording clock, waveform, transcript that grows as
// the call goes on, action items and decisions flagged as they are said, keywords, and "End call", which turns the flagged
// action lines into todos and writes the summary. The feed is a replay in development and is labelled as one.
import { Bento, BentoHead, Dot, PillButton, Waveform, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { endMeetingAction } from "@/lib/data/actions";
import { extractKeywords, mmss } from "@/lib/meetings";

interface Line {
  at: string;
  speaker: string;
  text: string;
  flag?: "action" | "decision" | "keyword";
}

export function LiveNotes({ meeting, canEnd }: { meeting: { id: string; title: string; project: string; lines: Line[] }; canEnd: boolean }) {
  const [shown, setShown] = useState(Math.min(2, meeting.lines.length));
  const [seconds, setSeconds] = useState(24 * 60 + 18);
  const [ended, setEnded] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (ended) return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const reveal = setInterval(() => setShown((n) => Math.min(meeting.lines.length, n + 1)), 3500);
    return () => {
      clearInterval(tick);
      clearInterval(reveal);
    };
  }, [ended, meeting.lines.length]);

  const lines = meeting.lines.slice(0, shown);
  const actions = lines.filter((l) => l.flag === "action");
  const decisions = lines.filter((l) => l.flag === "decision");
  const keywords = extractKeywords(lines);

  return (
    <div className="eb-grid" style={{ ["--cols" as string]: "1.4fr 1fr", alignItems: "start" }}>
      <Bento tone="black" className="eb-stack" aria-label="Live transcript" aria-live="polite">
        <div className="eb-row" style={{ justifyContent: "space-between" }}>
          <span className="eb-row" style={{ gap: 8 }}>
            <span className="eb-dot" style={{ background: "#ff4b3a", animationDuration: "1.2s" }} role="img" aria-label="Recording" />
            {ended ? "Ended" : "Recording"} · {mmss(seconds)}
          </span>
          <span className="eb-note">{meeting.title} · {meeting.project} · replay of a recorded session</span>
        </div>
        <Waveform bars={48} playing={!ended} progress={1} seed={3} />
        <ol className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {lines.map((l, i) => (
            <li key={i} style={{ fontSize: "var(--eb-t-md)", lineHeight: 1.55, color: i === lines.length - 1 && !ended ? "#eee" : "#bbb" }}>
              <span className="eb-mono" style={{ color: "#8a8a8a", marginRight: 10 }}>{l.at}</span>
              <b>{l.speaker}:</b> {l.text}
              {l.flag === "action" ? <span className="eb-pill" data-tone="lime" data-size="sm" style={{ marginLeft: 8 }}>action</span> : null}
              {l.flag === "decision" ? <span className="eb-pill" data-tone="lavender" data-size="sm" style={{ marginLeft: 8 }}>decision</span> : null}
            </li>
          ))}
        </ol>
        {!ended && shown < meeting.lines.length ? <p className="eb-note"><Dot /> listening…</p> : null}
      </Bento>

      <div className="eb-stack">
        <Bento tone="lime" aria-label="Action items flagged">
          <BentoHead title="Action items flagged" />
          {actions.length ? (
            <ul className="eb-stack tight" style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {actions.map((a, i) => (
                <li key={i} className="eb-body">→ <b>{a.speaker}:</b> {a.text}</li>
              ))}
            </ul>
          ) : (
            <p className="eb-body" style={{ marginTop: 8 }}>None yet.</p>
          )}
        </Bento>
        <Bento tone="lavender" aria-label="Keywords">
          <BentoHead title="Keywords" />
          <div className="eb-row" style={{ marginTop: 10 }}>
            {keywords.length ? keywords.map((k) => <span key={k} className="eb-pill">{k}</span>) : <span className="eb-body">Listening for names, amounts and dates.</span>}
          </div>
          {decisions.length ? <p className="eb-note" style={{ marginTop: 10 }}>{decisions.length} decision{decisions.length > 1 ? "s" : ""} flagged. They go to the decision queue as drafts after the call.</p> : null}
        </Bento>
        <Bento tone="strong" className="eb-row" style={{ justifyContent: "space-between" }}>
          <span className="eb-body">{ended ? "Summary written. Action items are in Todos." : "Post-call summary generates on stop"}</span>
          {canEnd && !ended ? (
            <PillButton
              tone="black"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const res = await endMeetingAction(meeting.id);
                  if (res.ok) {
                    setEnded(true);
                    toast(res.message ?? "Meeting ended.");
                    router.refresh();
                  } else toast(res.error, "danger");
                })
              }
            >
              End call
            </PillButton>
          ) : null}
        </Bento>
      </div>
    </div>
  );
}
