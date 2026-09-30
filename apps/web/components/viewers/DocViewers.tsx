"use client";
// Owner task: EB-102 File viewers — Word document viewer (screen 32) and slide deck viewer (screen 33). Both render the
// parsed structure (headings, paragraphs, bullets, speaker notes), not the original binary.
import { PillButton } from "@klarity/ui";
import { useState } from "react";

import type { FileContent } from "@/lib/data/types";

export function DocxViewer({ content }: { content: Extract<FileContent, { kind: "docx" }> }) {
  const items: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) items.push(<ul key={`l${items.length}`} className="eb-doc-list">{list.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    list = [];
  };
  content.blocks.forEach((b, i) => {
    if (b.type === "li") return void list.push(b.text);
    flush();
    if (b.type === "h1") items.push(<h3 key={i} className="eb-h-lg">{b.text}</h3>);
    else if (b.type === "h2") items.push(<h4 key={i} className="eb-h">{b.text}</h4>);
    else items.push(<p key={i} className="eb-body">{b.text}</p>);
  });
  flush();
  return <article className="eb-doc-page" aria-label="Document">{items}</article>;
}

export function PptxViewer({ content }: { content: Extract<FileContent, { kind: "pptx" }> }) {
  const [i, setI] = useState(0);
  const slide = content.slides[i];
  if (!slide) return <p className="eb-body">This deck has no slides.</p>;
  return (
    <div className="eb-pptx">
      <ol className="eb-pptx-rail" aria-label="Slides">
        {content.slides.map((s, k) => (
          <li key={k}>
            <button type="button" aria-current={k === i ? "true" : undefined} onClick={() => setI(k)} aria-label={`Slide ${k + 1}: ${s.title}`}>
              <span className="eb-mono">{k + 1}</span> <span className="eb-trunc">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div>
        <section className="eb-slide" aria-label={`Slide ${i + 1} of ${content.slides.length}`}>
          <h3 className="eb-h-lg">{slide.title}</h3>
          <ul>{slide.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>
        </section>
        {slide.notes ? <p className="eb-note" style={{ marginTop: 8 }}><b>Speaker notes: </b>{slide.notes}</p> : null}
        <div className="eb-row" style={{ gap: 6, marginTop: 8 }}>
          <PillButton size="sm" tone="outline" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</PillButton>
          <PillButton size="sm" tone="outline" disabled={i === content.slides.length - 1} onClick={() => setI(i + 1)}>Next</PillButton>
        </div>
      </div>
    </div>
  );
}
