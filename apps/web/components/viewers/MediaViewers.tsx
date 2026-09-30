"use client";
// Owner task: EB-102 File viewers — image (screen 34), video (35) and audio (36) viewers. The original media bytes are not
// held by the dev data layer, so the stage is a labelled placeholder; the parsed chapters, captions and transcript — the
// part the Brain actually indexes — are real and seek the timeline.
import { StripedPlaceholder, Waveform, formatDateTime } from "@klarity/ui";
import { useState } from "react";

import type { FileContent } from "@/lib/data/types";
import { mmss } from "@/lib/meetings";

const clock = (s: number) => mmss(s).replace(/^00:/, "");

export function ImageViewer({ content }: { content: Extract<FileContent, { kind: "image" }> }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div>
      <div className="eb-media-stage" style={{ overflow: "auto" }}>
        <div style={{ width: `${zoom * 100}%`, aspectRatio: `${content.width} / ${content.height}` }}>
          <StripedPlaceholder label={content.caption} height={200}>{content.caption}</StripedPlaceholder>
        </div>
      </div>
      <div className="eb-row" style={{ gap: 8, marginTop: 8 }}>
        <label className="eb-row" style={{ gap: 8 }}>
          <span className="eb-note">Zoom</span>
          <input type="range" min={1} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-valuetext={`${Math.round(zoom * 100)}%`} />
        </label>
        <span className="eb-mono eb-dim">{content.width} × {content.height}</span>
      </div>
      <dl className="eb-kv" style={{ marginTop: 10 }}>
        <dt>Taken</dt><dd>{formatDateTime(content.takenAt)}</dd>
        <dt>Location</dt><dd>{content.location}</dd>
        <dt>Tags</dt><dd>{content.tags.join(", ")}</dd>
      </dl>
    </div>
  );
}

function Scrubber({ at, total, onChange }: { at: number; total: number; onChange: (n: number) => void }) {
  return (
    <div className="eb-row" style={{ gap: 8 }}>
      <span className="eb-mono">{clock(at)}</span>
      <input className="eb-grow" type="range" min={0} max={total} value={at} onChange={(e) => onChange(Number(e.target.value))} aria-label="Timeline" aria-valuetext={`${clock(at)} of ${clock(total)}`} />
      <span className="eb-mono eb-dim">{clock(total)}</span>
    </div>
  );
}

export function VideoViewer({ content }: { content: Extract<FileContent, { kind: "video" }> }) {
  const [at, setAt] = useState(0);
  const caption = [...content.captions].reverse().find((c) => c.at <= at);
  return (
    <div>
      <div className="eb-media-stage">
        <StripedPlaceholder label="Video preview" height={220}>Preview — the original video stays in its source</StripedPlaceholder>
        {caption ? <p className="eb-caption" aria-live="polite">{caption.text}</p> : null}
      </div>
      <Scrubber at={at} total={content.durationSec} onChange={setAt} />
      <h3 className="eb-h" style={{ marginTop: 10 }}>Chapters</h3>
      <ul className="eb-list">
        {content.chapters.map((c) => (
          <li key={c.at}>
            <button type="button" className="eb-li" onClick={() => setAt(c.at)} aria-current={at >= c.at ? "true" : undefined}>
              <span className="eb-mono" style={{ width: 54 }}>{clock(c.at)}</span><span className="eb-li-title">{c.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AudioViewer({ content }: { content: Extract<FileContent, { kind: "audio" }> }) {
  const [at, setAt] = useState(0);
  return (
    <div>
      <p className="eb-note">Voice note from {content.from}</p>
      <div className="eb-media-stage" style={{ padding: 16 }}><Waveform bars={64} progress={content.durationSec ? at / content.durationSec : 0} /></div>
      <Scrubber at={at} total={content.durationSec} onChange={setAt} />
      <h3 className="eb-h" style={{ marginTop: 10 }}>Transcript</h3>
      <ul className="eb-list" aria-label="Transcript">
        {content.transcript.map((t) => (
          <li key={t.at}>
            <button type="button" className="eb-li" onClick={() => setAt(t.at)} data-selected={at >= t.at && (content.transcript.find((x) => x.at > t.at)?.at ?? Infinity) > at ? true : undefined}>
              <span className="eb-mono" style={{ width: 54 }}>{clock(t.at)}</span><span className="eb-body">{t.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
