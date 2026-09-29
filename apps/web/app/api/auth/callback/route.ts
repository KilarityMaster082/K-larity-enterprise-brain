// Owner task: EB-92 Web auth — OIDC redirect target: check state, exchange the code, verify the ID token,
// map organizations to tenants and write the signed session.
import { NextResponse, type NextRequest } from "next/server";

import { oidcConfig, sessionSecret } from "@/lib/auth/config";
import { membershipsFromClaims } from "@/lib/auth/memberships";
import { finishLogin, type LoginRequest } from "@/lib/auth/oidc";
import { safeNext } from "@klarity/web-auth";
import { writeSession } from "@/lib/auth/session";
import { verifyValue } from "@klarity/web-auth";
import { tenantByOrg } from "@/lib/tenants";

const OIDC_COOKIE = "kb_oidc";

function fail(req: NextRequest, code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth" });
  return res;
}

export async function GET(req: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login", req.url));
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(req, "idp_denied");
  const login = await verifyValue<LoginRequest & { at: number }>(req.cookies.get(OIDC_COOKIE)?.value, sessionSecret());
  if (!login || Date.now() - login.at > 600_000) return fail(req, "expired");
  const code = params.get("code");
  if (!code || params.get("state") !== login.state) return fail(req, "state");

  let claims;
  try {
    claims = await finishLogin(cfg, code, login);
  } catch {
    return fail(req, "token");
  }
  const memberships = membershipsFromClaims(claims);
  if (!memberships.length) return fail(req, "no_workspace");
  const wanted = login.org ? tenantByOrg(login.org)?.tenantId : undefined;
  const active = memberships.find((m) => m.tenantId === wanted) ?? memberships[0]!;

  await writeSession({
    mode: "oidc",
    user: {
      id: claims.sub,
      name: (claims.name as string | undefined) ?? (claims.preferred_username as string | undefined) ?? "User",
      email: (claims.email as string | undefined) ?? "",
    },
    tenantId: active.tenantId,
    memberships,
  });
  const res = NextResponse.redirect(new URL(safeNext(login.next), req.url));
  res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth" });
  return res;
}
