// Owner task: EB-92 Web auth — start OIDC sign-in (optionally into a specific organization = tenant).
import { NextResponse, type NextRequest } from "next/server";

import { oidcConfig, sessionSecret } from "@/lib/auth/config";
import { beginLogin } from "@/lib/auth/oidc";
import { safeNext } from "@klarity/web-auth";
import { signValue } from "@klarity/web-auth";
import { tenantByOrg } from "@/lib/tenants";

const OIDC_COOKIE = "kb_oidc";

export async function GET(req: NextRequest) {
  const cfg = oidcConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login", req.url));
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const orgParam = req.nextUrl.searchParams.get("org") ?? undefined;
  const org = orgParam && tenantByOrg(orgParam) ? orgParam : undefined; // only known organisations
  try {
    const { url, req: login } = await beginLogin(cfg, next, org);
    const res = NextResponse.redirect(url);
    res.cookies.set(OIDC_COOKIE, await signValue({ ...login, at: Date.now() }, sessionSecret()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: 600,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=idp_unavailable", req.url));
  }
}
