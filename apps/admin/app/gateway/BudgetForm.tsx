"use client";
// Owner task: EB-26 LiteLLM gateway — change a tenant's monthly cap. Needs a reason; the server action audits it.
import { Modal, useToast } from "@klarity/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setGatewayBudgetAction } from "@/lib/actions";

export function BudgetForm({ tenantId, tenant, cap }: { tenantId: string; tenant: string; cap: number }) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="eb-pill" data-tone="outline" data-size="sm" onClick={() => setOpen(true)}>Change monthly cap</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Monthly cap for ${tenant}`}>
        <form
          className="eb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const r = await setGatewayBudgetAction(tenantId, Number(f.get("cap")), String(f.get("reason")));
              if (r.ok) {
                toast(r.message ?? "Saved.");
                setOpen(false);
                router.refresh();
              } else toast(r.error, "danger");
            });
          }}
        >
          <label className="field">
            Cap in US dollars <span className="field-hint">$50 to $5,000. The gateway blocks calls at the cap.</span>
            <input name="cap" type="number" className="eb-input" min={50} max={5000} step={10} defaultValue={cap} required />
          </label>
          <label className="field">
            Reason <span className="field-hint">recorded in the audit log</span>
            <textarea name="reason" className="textarea" rows={2} required minLength={10} maxLength={300} />
          </label>
          <div className="eb-row"><button type="submit" className="eb-pill" data-tone="black" disabled={busy}>Save cap</button></div>
        </form>
      </Modal>
    </div>
  );
}
