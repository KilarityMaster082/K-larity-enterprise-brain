"use client";
// Owner task: EB-104 Knowledge hub — interactive graph: click or press Enter on a node to select it; its edges light up and
// the side panel lists the connected nodes and their evidence. "3D" tilts the same layout in perspective.
import { Bento, NodeGraph, Pill, PillButton } from "@klarity/ui";
import { useState } from "react";

import { EvidenceLinks } from "@/components/evidence/EvidenceLinks";
import type { Evidence } from "@/lib/contracts";

interface Node {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  r: number;
  color: string;
  evidence: Evidence[];
}

export function GraphView({ nodes, edges, initial }: { nodes: Node[]; edges: [string, string][]; initial?: string }) {
  const [sel, setSel] = useState(initial);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const node = nodes.find((n) => n.id === sel);
  const linked = node ? edges.filter(([a, b]) => a === node.id || b === node.id).map(([a, b]) => nodes.find((n) => n.id === (a === node.id ? b : a))).filter((n): n is Node => Boolean(n)) : [];

  if (!nodes.length) return <Bento tone="sky" pad="lg"><p className="eb-body">The graph fills in as sources are indexed and entities are resolved.</p></Bento>;

  return (
    <div className="eb-grid" style={{ ["--cols" as string]: "1fr 290px", alignItems: "start" }}>
      <Bento tone="graphite" pad="0" style={{ position: "relative", minHeight: 420 }} aria-label="Knowledge graph">
        <div className="eb-row" style={{ position: "absolute", left: 14, top: 14, zIndex: 2 }}>
          <PillButton tone={mode === "2d" ? "lime" : "outline-dark"} aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>2D</PillButton>
          <PillButton tone={mode === "3d" ? "lime" : "outline-dark"} aria-pressed={mode === "3d"} onClick={() => setMode("3d")} title="The same layout, tilted in perspective">3D</PillButton>
        </div>
        <div className="eb-graph-stage" data-mode={mode}>
          <NodeGraph nodes={nodes} edges={edges} selectedId={sel} onSelect={setSel} label="Relationships between projects, vendors, drawings, milestones and decisions" />
        </div>
      </Bento>
      <div className="eb-stack">
        <Bento tone="lime" aria-live="polite" aria-label="Selected node">
          <h2 className="eb-eyebrow">Selected</h2>
          <p className="eb-big-md" style={{ marginTop: 6 }}>{node?.label ?? "Nothing selected"}</p>
          <p className="eb-note">{node ? `${linked.length} connected node${linked.length === 1 ? "" : "s"} · ${node.kind}` : "Choose a node"}</p>
        </Bento>
        <Bento tone="strong" aria-label="Connected evidence">
          <h2 className="eb-h">Connected evidence</h2>
          <ul className="eb-list" style={{ marginTop: 6 }}>
            {linked.map((n) => (
              <li key={n.id} className="eb-li" style={{ flexWrap: "wrap" }}>
                <button type="button" className="eb-linklike eb-grow" onClick={() => setSel(n.id)}>{n.label} <span className="eb-dim">· {n.kind}</span></button>
                <EvidenceLinks evidence={n.evidence} citedFor={[`${node?.label} ↔ ${n.label}`]} compact />
              </li>
            ))}
          </ul>
          {node && node.evidence.length ? (
            <div style={{ marginTop: 8 }}>
              <p className="eb-note">About {node.label}</p>
              <EvidenceLinks evidence={node.evidence} citedFor={[node.label]} />
            </div>
          ) : null}
          {!linked.length ? <Pill tone="outline" size="sm">No links yet</Pill> : null}
        </Bento>
      </div>
    </div>
  );
}
