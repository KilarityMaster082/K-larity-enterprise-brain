// Owner task: EB-23 Web UI shell — sign-in page. Keycloak SSO when configured; a demo sign-in in `next dev`.
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { devSignIn } from "@/lib/auth-actions";
import { DEV_MEMBERSHIPS, authMode, getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/ask");
  const { next } = await searchParams;
  const dev = authMode() === "dev";

  return (
    <main className="login">
      <div className="card login-card">
        <div className="brand" aria-hidden="true">
          <span className="brand-mark">
            K<span className="brand-bang">!</span>
          </span>
          <span>
            K<span className="brand-bang">!</span>larity
            <span className="brand-sub">Enterprise Brain</span>
          </span>
        </div>
        <div>
          <h1>Sign in</h1>
          <p>Use your company account. You will only see answers from sources you have access to.</p>
        </div>

        <button type="button" className="btn btn-primary" disabled aria-describedby="sso-note">
          Continue with company SSO
        </button>
        <p id="sso-note" className="note" role="note">
          Single sign-on (Keycloak) is not configured in this environment yet.
        </p>

        {dev ? (
          <>
            <div className="divider">development only</div>
            <form action={devSignIn} className="login-card" style={{ padding: 0 }}>
              <input type="hidden" name="next" value={next ?? "/ask"} />
              <label className="field">
                Workspace
                <select name="tenantId" className="select" defaultValue={DEV_MEMBERSHIPS[0]!.tenantId}>
                  {DEV_MEMBERSHIPS.map((m) => (
                    <option key={m.tenantId} value={m.tenantId}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn">
                Continue as demo user
              </button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
