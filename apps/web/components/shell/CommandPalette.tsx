"use client";
// Owner task: EB-101 Command palette and global search — ⌘K / Ctrl+K (screen 42). WAI-ARIA combobox + listbox; results
// come from /api/search, which applies the caller's role and tenant before returning anything. Quick-switch to
// any screen the role may open, fuzzy-matched; typing a question offers to ask it.
import { Icon, type IconName, type LauncherGroup } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { fuzzyScore } from "@/lib/fuzzy";

export interface SearchHit {
  group: "Projects" | "Documents" | "Decisions" | "Email threads" | "Meetings" | "Todos" | "Spaces" | "Apps";
  label: string;
  sub?: string;
  href: string;
  icon: IconName;
}

type Item = { id: string; group: string; label: string; sub?: string; icon: IconName; run: () => void };

const GROUP_ORDER = ["Ask Brain", "Documents", "Email threads", "Decisions", "Projects", "Meetings", "Todos", "Spaces", "Apps", "Go to"];

export function CommandPalette({ open, onClose, launcher }: { open: boolean; onClose: () => void; launcher: LauncherGroup[] }) {
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQ("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    } else {
      opener.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits: SearchHit[] }) => setHits(d.hits))
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open]);

  const items: Item[] = useMemo(() => {
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const term = q.trim();
    const pages = launcher
      .flatMap((g) => g.items)
      .map((n) => ({ n, score: fuzzyScore(term, n.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, term ? 8 : 12)
      .map(({ n }) => ({ id: `nav-${n.href}-${n.title}`, group: "Go to", label: n.title, sub: n.href, icon: "chevronRight" as IconName, run: go(n.href) }));
    const found = hits.map((h, i) => ({ id: `hit-${i}`, group: h.group, label: h.label, sub: h.sub, icon: h.icon, run: go(h.href) }));
    const ask: Item[] = term ? [{ id: "ask", group: "Ask Brain", label: `Ask: “${term}”`, icon: "ask", run: go(`/ask?q=${encodeURIComponent(term)}`) }] : [];
    const all = [...ask, ...found, ...pages];
    return all.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }, [launcher, hits, q, router, onClose]);

  useEffect(() => setActive(0), [items.length]);
  useEffect(() => {
    document.getElementById(`${listId}-${items[active]?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, items, listId]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = "";
  return (
    <div
      className="eb-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="eb-palette" role="dialog" aria-modal="true" aria-label="Search and jump">
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${items[active]!.id}` : undefined}
          aria-autocomplete="list"
          aria-label="Search projects, documents, email threads and decisions, or ask a question"
          placeholder="Search projects, documents, threads, decisions — or ask a question"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul id={listId} className="eb-palette-list" role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0 }}>
          {items.length === 0 ? (
            <li className="eb-menu-label" role="presentation">
              No matches
            </li>
          ) : null}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id} role="presentation">
                {head ? (
                  <div className="eb-menu-label" role="presentation">
                    {head}
                  </div>
                ) : null}
                <div id={`${listId}-${it.id}`} role="option" aria-selected={i === active} tabIndex={-1} className="eb-palette-item" onMouseEnter={() => setActive(i)} onClick={it.run}>
                  <Icon name={it.icon} size={14} />
                  <span className="eb-grow eb-trunc">{it.label}</span>
                  {it.sub ? <span className="eb-dim" style={{ fontSize: "var(--eb-t-xs)", fontWeight: 400 }}>{it.sub}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="eb-palette-foot" aria-hidden="true">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
