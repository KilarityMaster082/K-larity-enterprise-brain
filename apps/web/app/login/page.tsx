// Owner task: EB-92 Web auth — SSO Sign-In & Tenant Switcher (screen 3). Google Workspace or Keycloak SSO when
// configured; a demo sign-in with workspace and role pickers in `next dev` so role rules can be tried; nobody can
// sign in when neither is available.
import { Bento, Grid, Icon } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { devSignIn } from "@/lib/auth-actions";
import { authMode } from "@/lib/auth/config";
import { safeNext } from "@klarity/web-auth";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import { TENANTS } from "@/lib/tenants";

import brandDark from "@klarity/ui/brand/logo-on-dark.png";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  expired: "The sign-in took too long. Please try again.",
  state: "The sign-in could not be verified. Please try again.",
  token: "Your identity provider's response could not be verified.",
  idp_denied: "Sign-in was cancelled or refused by your identity provider.",
  idp_unavailable: "Company sign-in is unavailable right now. Please try again shortly.",
  no_workspace: "Your account is not a member of any active K!larity workspace. Ask your administrator for an invitation.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getSession()) redirect("/ask");
  const { next, error } = await searchParams;
  const mode = authMode();
  const dest = safeNext(next);
  const active = TENANTS.filter((t) => t.status === "active");

  return (
    <div className="eb-page">
      <main className="eb-frame eb-login" id="main">
        <Grid cols="1fr 1fr" align="stretch" className="eb-login-grid">
          <Bento tone="black" pad="lg" className="eb-login-hero" aria-label="Sign in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandDark.src} width={120} height={Math.round((120 * brandDark.height) / brandDark.width)} alt="K!larity" />
            <div className="eb-stack">
              <h1 className="eb-hero-title" style={{ fontSize: "var(--eb-t-hero)" }}>
                Ask your firm.
                <br />
                <i className="eb-lime-text">Check</i> the answer.
              </h1>
              {error && ERRORS[error] ? (
                <p role="alert" className="eb-pill" data-tone="pink" style={{ whiteSpace: "normal" }}>
                  {ERRORS[error]}
                </p>
              ) : null}
              {mode === "oidc" ? (
                <div className="eb-stack tight" style={{ alignItems: "flex-start" }}>
                  <a className="eb-pill" data-size="lg" style={{ fontWeight: 600, padding: "10px 18px" }} href={`/api/auth/login?idp=google&next=${encodeURIComponent(dest)}`}>
                    Continue with Google Workspace
                  </a>
                  <a className="eb-note" style={{ color: "var(--eb-on-dark-3)" }} href={`/api/auth/login?next=${encodeURIComponent(dest)}`}>
                    or Keycloak SSO
                  </a>
                </div>
              ) : (
                <div className="eb-stack tight" style={{ alignItems: "flex-start" }}>
                  <button type="button" className="eb-pill" data-size="lg" disabled style={{ fontWeight: 600, padding: "10px 18px" }} aria-describedby="sso-note">
                    Continue with Google Workspace
                  </button>
                  <p id="sso-note" className="eb-note" role="note">
                    or Keycloak SSO · company sign-in is not configured in this environment.
                  </p>
                </div>
              )}
            </div>
            <span className="eb-login-orb" aria-hidden="true" />
          </Bento>

          {mode === "dev" ? (
            <form action={devSignIn} className="eb-stack" aria-label="Development sign-in">
              <input type="hidden" name="next" value={dest} />
              <Bento tone="green" aria-labelledby="ws-title">
                <h2 id="ws-title" className="eb-eyebrow">Switch workspace</h2>
                <fieldset className="eb-stack tight" style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
                  <legend className="visually-hidden">Workspace</legend>
                  {active.map((t, i) => (
                    <label key={t.tenantId} className="eb-choice">
                      <input type="radio" name="tenantId" value={t.tenantId} defaultChecked={i === 0} />
                      <span className="eb-avatar" style={{ borderRadius: 9, background: t.isSynthetic ? "#e3e3e3" : "var(--eb-black)", color: t.isSynthetic ? "var(--eb-black)" : "#fff" }}>
                        {t.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="eb-grow">{t.name}</span>
                      {t.isSynthetic ? <span className="eb-pill" data-tone="cream" data-size="sm">Synthetic tenant</span> : <Icon name="check" size={14} />}
                    </label>
                  ))}
                </fieldset>
              </Bento>
              <Bento tone="pink" aria-labelledby="role-title">
                <h2 id="role-title" className="eb-eyebrow">Preview role</h2>
                <fieldset className="eb-row" style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
                  <legend className="visually-hidden">Role</legend>
                  {ROLES.map((r) => (
                    <label key={r} className="eb-choice-pill">
                      <input type="radio" name="role" value={r} defaultChecked={r === "admin"} />
                      <span>{ROLE_LABEL[r]}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="eb-note" style={{ marginTop: 8 }}>Try different roles to see what each one can open.</p>
              </Bento>
              <Bento tone="sky" fill>
                <p className="eb-body">
                  <b>Permission-aware answers.</b> The Brain searches only sources your role can open. Finance and Executive are owner and partner only.
                </p>
                <button type="submit" className="eb-pill" data-tone="black" data-size="lg" style={{ justifyContent: "center" }}>
                  Continue as demo user
                </button>
              </Bento>
            </form>
          ) : (
            <Stack>
              <Bento tone="sky" fill>
                <p className="eb-body">
                  <b>Permission-aware answers.</b> The Brain searches only sources your role can open. Finance and Executive are owner and partner only.
                </p>
              </Bento>
            </Stack>
          )}
        </Grid>
      </main>
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="eb-stack">{children}</div>;
}
