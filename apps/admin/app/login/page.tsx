// Owner task: EB-100 Admin console shell — operator sign-in (development only until the operator realm lands).
import { Logo } from "@klarity/ui";
import { safeNext } from "@klarity/web-auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { devOperatorSignIn } from "@/lib/actions";
import { adminAuthMode, getOperator } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getOperator()) redirect("/tenants");
  const { next } = await searchParams;
  return (
    <main className="login">
      <div className="card login-card">
        <Logo width={160} caption="Operator console" />
        <div className="stack-sm">
          <h1 style={{ fontSize: "var(--fs-xl)" }}>K!larity staff sign-in</h1>
          <p className="muted">This console manages every customer workspace. Every action is audited.</p>
        </div>
        {adminAuthMode() === "dev" ? (
          <form action={devOperatorSignIn} className="stack">
            <input type="hidden" name="next" value={safeNext(next, "/tenants")} />
            <p className="note">Development sign-in. Production uses the K!larity operator realm with multi-factor sign-in.</p>
            <button type="submit" className="btn btn-dark btn-block">
              Continue as demo operator
            </button>
          </form>
        ) : (
          <p className="note" role="alert">
            Operator sign-in is not configured in this environment.
          </p>
        )}
      </div>
    </main>
  );
}
