"use client";
// Owner task: EB-91 UI design system — interactive primitives: side sheet, confirm dialog, tabs, segmented
// control, toasts. Built on native <dialog> so Esc, focus trapping and inert backgrounds come from the browser.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "./Icon";

/** Right-hand side sheet. Opens when `open` is true; focus returns to whatever opened it. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const autoId = useId();
  const titleId = labelledBy ?? `${autoId}-title`;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${wide ? " sheet-wide" : ""}`}
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        opener.current?.focus();
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {open ? (
        <div className="sheet-body">
          <div className="sheet-head">
            {title ? <h2 id={titleId}>{title}</h2> : <span />}
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => ref.current?.close()}>
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Centred modal for confirmations and short forms. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={`${id}-t`}
      onClose={() => {
        onClose();
        opener.current?.focus();
      }}
    >
      {open ? (
        <div className="modal-body">
          <div className="row-between">
            <h2 id={`${id}-t`} style={{ fontSize: "var(--fs-lg)" }}>
              {title}
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => ref.current?.close()}>
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** WAI-ARIA tabs with arrow-key navigation. */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: string; label: ReactNode; count?: number }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = tabs.findIndex((t) => t.id === value);
  function onKey(e: KeyboardEvent) {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="badge" style={{ marginLeft: 6 }}>
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={!active}>
      {active ? children : null}
    </div>
  );
}

/** Mutually exclusive filter buttons (aria-pressed). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; text: string; tone: "default" | "danger" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: Toast["tone"] = "default") => {
    const id = next.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === "danger" ? " toast-danger" : ""}`}>
            <Icon name={t.tone === "danger" ? "alert" : "checkCircle"} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
