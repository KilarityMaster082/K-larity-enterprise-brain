// Owner task: EB-100 Admin console shell — Operator Login & Impersonation Gate (screen 46). Development sign-in only until
// the K!larity operator realm (Keycloak, multi-factor mandatory) is wired; in production nobody can sign in without it.
// The gate itself — a written reason, 30 minutes, every query audited — is on the tenant screen (48) and in the banner.
import { Bento, Grid, Icon } from "@klarity/ui";
import brandDark from "@klarity/ui/brand/logo-on-dark.png";
import { safeNext } from "@klarity/web-auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { devOperatorSignIn } from "@/lib/actions";
import { adminAuthMode, getOperator, IMPERSONATION_MINUTES } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getOperator()) redirect("/tenants");
  const { next } = await searchParams;
  return (
    <div className="eb-page">
      <main className="eb-frame eb-login" id="main">
        <Grid cols="1fr 1fr" align="stretch" className="eb-login-grid">
          <Bento tone="black" pad="lg" className="eb-login-hero" aria-label="Operator sign-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandDark.src} width={120} height={Math.round((120 * brandDark.height) / brandDark.width)} alt="K!larity" />
            <div className="eb-stack">
              <p className="eb-eyebrow" style={{ color: "var(--eb-on-dark-3)" }}>46 / 54 · Operator console</p>
              <h1 className="eb-hero-title" style={{ fontSize: "var(--eb-t-hero)" }}>
                K!larity staff
                <br />
                <i className="eb-lime-text">sign-in</i>
              </h1>
              {adminAuthMode() === "dev" ? (
                <form action={devOperatorSignIn} className="eb-stack tight" style={{ alignItems: "flex-start" }}>
                  <input type="hidden" name="next" value={safeNext(next, "/tenants")} />
                  <button type="submit" className="eb-pill" data-size="lg" style={{ fontWeight: 600, padding: "10px 18px", background: "var(--eb-lime)", color: "var(--eb-ink)" }}>
                    Continue as demo operator
                  </button>
                  <p className="eb-note" style={{ color: "var(--eb-on-dark-3)" }}>Development sign-in. Production uses the K!larity operator realm with multi-factor sign-in.</p>
                </form>
              ) : (
                <p role="alert" className="eb-pill" data-tone="pink" style={{ whiteSpace: "normal" }}>
                  Operator sign-in is not configured in this environment.
                </p>
              )}
            </div>
          </Bento>
          <Bento tone="lime" pad="lg" aria-label="How operator access works">
            <h2 className="eb-h-lg">Access is narrow, timed and recorded</h2>
            <ul className="eb-list" style={{ marginTop: 10 }}>
              {[
                ["lock", "Tenant content is hidden until you start an audited view of one tenant."],
                ["clock", `A view lasts ${IMPERSONATION_MINUTES} minutes, then ends on its own.`],
                ["edit", "You give a written reason (at least 10 characters) every time."],
                ["audit", "Start, end and every query are in the audit log, which the tenant can see."],
                ["shield", "Operator sessions use their own cookie and secret: they never work in a tenant app."],
              ].map(([icon, text]) => (
                <li key={text} className="eb-li" style={{ alignItems: "flex-start" }}>
                  <Icon name={icon as "lock"} size={14} />
                  <span className="eb-body">{text}</span>
                </li>
              ))}
            </ul>
          </Bento>
        </Grid>
      </main>
    </div>
  );
}
