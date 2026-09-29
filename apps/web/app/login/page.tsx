// Owner task: EB-92 Web auth — sign-in page. Company SSO (Keycloak) when configured; a demo sign-in with a
// role picker in `next dev` so role rules can be tried; nobody can sign in when neither is available.
import { Logo } from "@klarity/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { devSignIn } from "@/lib/auth-actions";
import { authMode } from "@/lib/auth/config";
import { safeNext } from "@klarity/web-auth";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABEL, ROLES } from "@/lib/permissions";
import { TENANTS } from "@/lib/tenants";

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

  return (
    <main className="login">
      <div className="card login-card">
        <Logo width={170} caption="Enterprise Brain" />
        <div className="stack-sm">
          <h1>Sign in</h1>
          <p>Use your company account. You will only see answers from sources you have access to.</p>
        </div>

        {error && ERRORS[error] ? (
          <p className="note" role="alert">
            {ERRORS[error]}
          </p>
        ) : null}

        {mode === "oidc" ? (
          <a className="btn btn-primary btn-block" href={`/api/auth/login?next=${encodeURIComponent(dest)}`}>
            Continue with company SSO
          </a>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled aria-describedby="sso-note">
              Continue with company SSO
            </button>
            <p id="sso-note" className="note note-info" role="note">
              Company sign-in (Keycloak) is not configured in this environment.
            </p>
          </>
        )}

        {mode === "dev" ? (
          <>
            <div className="divider">development only</div>
            <form action={devSignIn} className="login-form">
              <input type="hidden" name="next" value={dest} />
              <label className="field">
                Workspace
                <select name="tenantId" className="select" defaultValue={TENANTS[0]!.tenantId}>
                  {TENANTS.filter((t) => t.status === "active").map((t) => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Role
                <select name="role" className="select" defaultValue="admin">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <span className="field-hint">Try different roles to see what each one can open.</span>
              </label>
              <button type="submit" className="btn btn-dark">
                Continue as demo user
              </button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
