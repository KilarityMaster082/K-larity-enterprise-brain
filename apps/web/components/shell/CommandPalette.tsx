"use client";
// Owner task: EB-101 Command palette and global search — ⌘K / Ctrl+K. WAI-ARIA combobox + listbox; results
// come from /api/search, which applies the caller's role before returning anything.
import { Icon, type IconName } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { NavItem } from "@/lib/nav";

export interface SearchHit {
  group: "Projects" | "Documents" | "Decisions";
  label: string;
  sub?: string;
  href: string;
  icon: IconName;
}

type Item = { id: string; group: string; label: string; sub?: string; icon: IconName; run: () => void };

export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    } else if (!open && d.open) d.close();
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
    const term = q.trim().toLowerCase();
    const pages = nav
      .filter((n) => !term || n.label.toLowerCase().includes(term))
      .map((n) => ({ id: `nav-${n.href}`, group: "Go to", label: n.label, icon: n.icon, run: go(n.href) }));
    const found = hits.map((h, i) => ({ id: `hit-${i}`, group: h.group, label: h.label, sub: h.sub, icon: h.icon, run: go(h.href) }));
    const ask: Item[] = term
      ? [{ id: "ask", group: "Ask Brain", label: `Ask: “${q.trim()}”`, icon: "ask", run: go(`/ask?q=${encodeURIComponent(q.trim())}`) }]
      : [];
    return [...ask, ...found, ...pages];
  }, [nav, hits, q, router, onClose]);

  useEffect(() => setActive(0), [items.length]);

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
    <dialog
      ref={ref}
      className="palette"
      aria-label="Search and jump"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <input
        ref={input}
        className="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={items[active] ? `${listId}-${items[active]!.id}` : undefined}
        aria-autocomplete="list"
        aria-label="Search projects, documents and decisions, or ask a question"
        placeholder="Search projects, documents, decisions — or ask a question"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
      />
      <ul id={listId} className="palette-list" role="listbox" aria-label="Results">
        {items.length === 0 ? (
          <li className="palette-group" role="presentation">
            No matches
          </li>
        ) : null}
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <li key={it.id} role="presentation">
              {head ? (
                <div className="palette-group" role="presentation">
                  {head}
                </div>
              ) : null}
              <div
                id={`${listId}-${it.id}`}
                role="option"
                aria-selected={i === active}
                className="palette-item"
                onMouseEnter={() => setActive(i)}
                onClick={it.run}
              >
                <Icon name={it.icon} size={16} />
                <span>{it.label}</span>
                {it.sub ? <span className="palette-sub">{it.sub}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="palette-foot" aria-hidden="true">
        <span>↑↓ move</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </dialog>
  );
}
