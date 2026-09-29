// Owner task: EB-91 UI design system and component library — the living catalogue: brand, tokens, and every
// component in its states. Any signed-in user can open it; it shows no tenant data.
import { Badge, BarChart, buttonClass, Card, EmptyState, Icon, KpiTile, Logo, LogoMark, Meter, Money, PageHeader, Skeleton, SourceTag, Stepper, Timeline } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";

import { InteractiveDemos } from "./InteractiveDemos";

export const metadata: Metadata = { title: "Design system" };

const SWATCHES: { token: string; use: string }[] = [
  { token: "--brand", use: "Primary actions, current item, focus accents (logo orange #fd5910)" },
  { token: "--ink", use: "Wordmark ink; dark buttons" },
  { token: "--brand-ink", use: "Orange as text or links (AA on every surface)" },
  { token: "--bg", use: "Page background" },
  { token: "--surface", use: "Cards, sheets, menus" },
  { token: "--surface-2", use: "Table headers, tracks, quiet fills" },
  { token: "--text", use: "Body text" },
  { token: "--text-2", use: "Secondary text" },
  { token: "--text-3", use: "Muted text (still AA)" },
  { token: "--ok", use: "On track, healthy, confirmed" },
  { token: "--warn", use: "At risk, needs attention" },
  { token: "--danger", use: "Off track, overdue, destructive" },
  { token: "--info", use: "Informational, drafts" },
  { token: "--mark-bg", use: "Highlighted evidence passage" },
];

export default async function DesignPage() {
  if (!(await getSession())) redirect("/login?next=/design");
  return (
    <div className="content content-wide">
      <PageHeader title="Design system" lead="@klarity/ui — brand, tokens and components shared by the Brain and the operator console. WCAG 2.1 AA in light and dark (checked by tests)." />
      <div className="stack-lg">
        <Card title="Brand">
          <div className="row" style={{ gap: "var(--s-8)", alignItems: "center" }}>
            <Logo width={220} caption="Enterprise Brain" />
            <LogoMark size={56} label="K!larity mark" />
            <p className="muted" style={{ maxWidth: "48ch", fontSize: "var(--fs-sm)" }}>
              The asterisk mark and the “!” are always brand orange. The wordmark is ink on light surfaces and white on dark ones. Keep
              clear space of one “k” height around the logo; never recolour or stretch it.
            </p>
          </div>
        </Card>

        <Card title="Colour tokens">
          <div className="grid-3">
            {SWATCHES.map((s) => (
              <div key={s.token} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                <span aria-hidden="true" style={{ width: 40, height: 40, flex: "none", borderRadius: 10, background: `var(${s.token})`, border: "1px solid var(--border)" }} />
                <span className="stack-sm" style={{ gap: 0 }}>
                  <code>{s.token}</code>
                  <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                    {s.use}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Buttons">
          <div className="row">
            <button type="button" className={buttonClass({ variant: "primary" })}>
              Primary
            </button>
            <button type="button" className={buttonClass({ variant: "dark" })}>
              Dark
            </button>
            <button type="button" className={buttonClass()}>
              Default
            </button>
            <button type="button" className={buttonClass({ variant: "ghost" })}>
              Ghost
            </button>
            <button type="button" className={buttonClass({ variant: "danger" })}>
              Danger
            </button>
            <button type="button" className={buttonClass({ variant: "primary" })} disabled>
              Disabled
            </button>
            <button type="button" className={buttonClass({ size: "sm" })}>
              Small
            </button>
            <button type="button" className={buttonClass({ icon: true })} aria-label="Search">
              <Icon name="search" />
            </button>
          </div>
        </Card>

        <Card title="Badges">
          <div className="row">
            <Badge>Neutral</Badge>
            <Badge tone="ok">On track</Badge>
            <Badge tone="warn">At risk</Badge>
            <Badge tone="danger">Off track</Badge>
            <Badge tone="info">Draft</Badge>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="solid">Rev C</Badge>
            <SourceTag query="finance.variance_by_package" />
          </div>
        </Card>

        <Card title="Numbers">
          <div className="kpis">
            <KpiTile label="Receivables outstanding" value={<Money amount={8600000} />} foot={<SourceTag query="finance.open_receivables" />} accent />
            <KpiTile label="Overdue" value={<Money amount={4000000} />} tone="danger" foot="Chase these first" />
            <KpiTile label="Forecast overrun" value={<Money amount={2140000} />} foot="Hover a value for the exact rupees" />
          </div>
          <div style={{ marginTop: "var(--s-5)", maxWidth: 420 }} className="stack">
            <Meter value={11400000} max={15300000} label="Within budget" format={(n) => `₹${(n / 1e5).toFixed(1)} lakh`} />
            <Meter value={14200000} max={15300000} label="Near budget" format={(n) => `₹${(n / 1e5).toFixed(1)} lakh`} />
            <Meter value={17140000} max={15300000} label="Over budget" format={(n) => `₹${(n / 1e5).toFixed(1)} lakh`} />
          </div>
        </Card>

        <div className="grid-2">
          <Card title="Bar chart (with table alternative)">
            <BarChart
              label="Example ageing"
              data={[
                { label: "Not due", value: 4600000, tone: "ok" },
                { label: "1–30 days", value: 2200000 },
                { label: "31–60 days", value: 1800000, tone: "danger" },
              ]}
            />
          </Card>
          <Card title="Stepper and timeline">
            <div className="stack">
              <Stepper steps={["Concept", "Design", "GFC drawings", "Execution", "Handover"]} current={3} label="Stage: Execution" />
              <Timeline
                label="Example timeline"
                items={[
                  { id: "1", when: "12 Aug", title: "Client chose HPL facade", icon: "chat", tone: "brand" },
                  { id: "2", when: "2 Sep", title: "Variation sent for signature", icon: "alert", tone: "danger" },
                  { id: "3", when: "20 Sep", title: "RA-3 raised", icon: "finance", tone: "ok" },
                ]}
              />
            </div>
          </Card>
        </div>

        <div className="grid-2">
          <EmptyState icon="plug" title="Empty state" action={<button type="button" className="btn btn-primary">Next step</button>} compact>
            <p>Explain what will appear here and link to the step that makes it appear. Never a dead end.</p>
          </EmptyState>
          <Card title="Loading">
            <div className="stack-sm">
              <Skeleton width="60%" height={18} />
              <Skeleton />
              <Skeleton width="85%" />
            </div>
          </Card>
        </div>

        <InteractiveDemos />
      </div>
    </div>
  );
}
