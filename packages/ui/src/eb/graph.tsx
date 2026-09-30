"use client";
// Owner task: EB-91 UI design system — interactive node-link graph (Knowledge graph, screen 11).
// Nodes are keyboard-focusable buttons; the selected node highlights its edges.

export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
}

export function NodeGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  label,
}: {
  nodes: readonly GraphNode[];
  edges: readonly (readonly [string, string])[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  label: string;
}) {
  const by = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg className="eb-svg-graph" width="100%" viewBox="0 0 800 640" preserveAspectRatio="xMidYMid meet" role="group" aria-label={label}>
      {edges.map(([a, b]) => {
        const p = by.get(a);
        const q = by.get(b);
        if (!p || !q) return null;
        const hot = selectedId === a || selectedId === b;
        return <line key={`${a}-${b}`} className="eb-edge" x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={hot ? "#d2ff1f" : "#8b8890"} strokeWidth={hot ? 1.6 : 1} strokeDasharray="4 8" />;
      })}
      {nodes.map((n) => (
        <g key={n.id} className="eb-float" style={{ animationDuration: `${4 + (n.id.length % 4)}s` }}>
          <circle className="eb-node-ring" cx={n.x} cy={n.y} r={n.r} fill="none" stroke={n.color} />
          <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} stroke={selectedId === n.id ? "#fff" : "none"} strokeWidth="2" />
          <text x={n.x} y={n.y + n.r + 15} textAnchor="middle" fontSize="11" fill="#eee">
            {n.label}
          </text>
          {onSelect ? (
            <circle
              cx={n.x}
              cy={n.y}
              r={Math.max(n.r, 16)}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${n.label}${selectedId === n.id ? " (selected)" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(n.id);
                }
              }}
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}
