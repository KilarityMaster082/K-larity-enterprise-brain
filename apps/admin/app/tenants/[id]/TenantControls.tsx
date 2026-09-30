"use client";
// Owner task: EB-88 Tenant admin console — suspend/resume, plan change and impersonation, each needing a reason.
import { Modal, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { changePlanAction, setStatusAction, startImpersonationAction, stopImpersonationAction, type Result } from "@/lib/actions";
import { PLANS } from "@/lib/plans";

/** Refreshes the page every second while provisioning runs. */
export function ProvisionWatcher() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 1000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

type Dialog = "suspend" | "resume" | "plan" | "impersonate" | null;

export function TenantControls({ tenantId, name, status, plan, impersonatingThis }: { tenantId: string; name: string; status: string; plan: string; impersonatingThis: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function run(p: () => Promise<Result>, after?: () => void) {
    start(async () => {
      const r = await p();
      if (r.ok) {
        toast(r.message ?? "Done.");
        setDialog(null);
        after?.();
        router.refresh();
      } else toast(r.error, "danger");
    });
  }

  const reasonField = (hint: string) => (
    <label className="field">
      Reason <span className="field-hint">{hint}</span>
      <textarea name="reason" className="textarea" rows={2} required minLength={10} maxLength={300} />
    </label>
  );

  return (
    <div className="stack">
      <div className="stack-sm">
        {impersonatingThis ? (
          <button type="button" className="eb-pill" data-tone="black" disabled={busy} onClick={() => run(() => stopImpersonationAction())}>
            Stop viewing {name}
          </button>
        ) : (
          <button type="button" className="eb-pill" data-tone="black" disabled={status !== "active"} onClick={() => setDialog("impersonate")}>
            View tenant data (audited)
          </button>
        )}
        <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          Needed for the retrieval console. Lasts 30 minutes, needs a reason, and is recorded.
        </span>
      </div>
      <div className="row">
        {status === "active" ? (
          <button type="button" className="eb-pill" data-tone="pink" onClick={() => setDialog("suspend")}>
            Suspend
          </button>
        ) : null}
        {status === "suspended" ? (
          <button type="button" className="eb-pill" data-tone="outline" onClick={() => setDialog("resume")}>
            Resume
          </button>
        ) : null}
        <button type="button" className="eb-pill" data-tone="outline" disabled={status === "provisioning"} onClick={() => setDialog("plan")}>
          Change plan
        </button>
        <button type="button" className="eb-pill" data-tone="outline" disabled title="Offboarding with a deletion certificate arrives with EB-89">
          Offboard…
        </button>
      </div>

      <Modal open={dialog === "impersonate"} onClose={() => setDialog(null)} title={`View ${name}'s data`}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); run(() => startImpersonationAction(tenantId, reason)); }}>
          <p>You will see this tenant&apos;s content in the retrieval console for 30 minutes. The tenant can see this in their audit log.</p>
          {reasonField("e.g. support ticket number and what you are checking")}
          <div className="row">
            <button type="submit" className="eb-pill" data-tone="black" disabled={busy}>
              Start viewing
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "suspend" || dialog === "resume"} onClose={() => setDialog(null)} title={dialog === "suspend" ? `Suspend ${name}?` : `Resume ${name}?`}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason")); run(() => setStatusAction(tenantId, dialog === "suspend" ? "suspended" : "active", reason)); }}>
          <p>{dialog === "suspend" ? "Members are signed out and nobody in this tenant can sign in until it is resumed. Data is kept." : "Members can sign in again."}</p>
          {reasonField("recorded in the audit log")}
          <div className="row">
            <button type="submit" className="eb-pill" data-tone={dialog === "suspend" ? "pink" : "black"} disabled={busy}>
              {dialog === "suspend" ? "Suspend tenant" : "Resume tenant"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "plan"} onClose={() => setDialog(null)} title="Change plan">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => changePlanAction(tenantId, String(f.get("plan")), String(f.get("reason")))); }}>
          <label className="field">
            Plan
            <select name="plan" className="select" defaultValue={plan}>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {reasonField("recorded in the audit log")}
          <div className="row">
            <button type="submit" className="eb-pill" data-tone="black" disabled={busy}>
              Change plan
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
