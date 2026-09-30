"use client";
// Owner task: EB-105 Meetings and live notes — call surface with local-only controls (mic, camera, screen share, record,
// leave) and captions that cycle through the meeting's transcript. No audio or video leaves the browser.
import { Icon, Pill, PillButton } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TILE_TONES = ["lime", "sky", "pink", "lavender", "green"] as const;

export function CallView({ title, me, others, share, captions }: { title: string; me: { name: string; initials: string }; others: { name: string; initials: string }[]; share?: string; captions: string[] }) {
  const router = useRouter();
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(Boolean(share));
  const [rec, setRec] = useState(false);
  const [cc, setCc] = useState(true);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!captions.length) return;
    const t = setInterval(() => setI((n) => (n + 1) % captions.length), 4000);
    return () => clearInterval(t);
  }, [captions.length]);

  const tiles = [{ ...me, name: `${me.name} (you)` }, ...others].slice(0, 4);
  const Btn = ({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" className="eb-callbtn" data-on={on || undefined} aria-pressed={on} aria-label={label} title={label} onClick={onClick}>{children}</button>
  );

  return (
    <section className="eb-call" aria-label={`Call: ${title}`}>
      <p className="eb-note" style={{ color: "#bbb", padding: "0 4px" }}>
        <Pill tone="cream" size="sm">Preview</Pill> Live media is not connected in this build: the controls below change only what you see here.
      </p>
      <div className="eb-call-grid">
        <div className="eb-call-stage" role="img" aria-label={sharing && share ? `Screen share: ${share}` : "No screen is being shared"}>
          <span className="eb-mono" style={{ color: "#888" }}>{sharing && share ? `screen share · ${share}` : "no screen shared"}</span>
          {sharing && share ? <span className="eb-pill" data-tone="lime" style={{ position: "absolute", left: 14, top: 14, fontWeight: 600 }}>Presenting</span> : null}
        </div>
        <div className="eb-call-tiles">
          {tiles.map((t, idx) => (
            <div key={t.name} className="eb-call-tile" data-speaking={idx === 0 && mic || undefined}>
              <span className="eb-avatar" style={{ width: 44, height: 44, background: `var(--eb-${TILE_TONES[idx % TILE_TONES.length]})`, animation: "eb-pulse 2s infinite" }}>{cam || idx > 0 ? t.initials : "–"}</span>
              <span className="eb-call-name">{t.name}{idx === 0 && !mic ? " · muted" : ""}</span>
            </div>
          ))}
        </div>
      </div>
      {cc && captions.length ? <p className="eb-call-cc" aria-live="polite">“{captions[i]}”</p> : null}
      <div className="eb-row" style={{ justifyContent: "center", gap: 10 }}>
        <Btn on={mic} label={mic ? "Mute microphone" : "Unmute microphone"} onClick={() => setMic((v) => !v)}><Icon name="mic" size={16} /></Btn>
        <Btn on={cam} label={cam ? "Turn camera off" : "Turn camera on"} onClick={() => setCam((v) => !v)}><Icon name="meetings" size={16} /></Btn>
        <Btn on={sharing} label={sharing ? "Stop sharing" : "Share a drawing"} onClick={() => setSharing((v) => !v)}><Icon name="drawing" size={16} /></Btn>
        <Btn on={cc} label={cc ? "Hide captions" : "Show captions"} onClick={() => setCc((v) => !v)}>CC</Btn>
        <PillButton tone={rec ? "lime" : "outline-dark"} size="lg" aria-pressed={rec} onClick={() => setRec((v) => !v)}>{rec ? "● Recording" : "● Record"}</PillButton>
        <button type="button" className="eb-callbtn eb-callbtn-leave" onClick={() => router.push("/meetings")}>Leave</button>
      </div>
    </section>
  );
}
