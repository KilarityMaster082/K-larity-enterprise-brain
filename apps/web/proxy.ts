// Owner task: EB-23 Web UI shell — send signed-out visitors to /login (Next 16 "proxy", formerly middleware).
// This is a UX gate only. Authorisation happens on the server for every page and API call.
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "kb_session"; // keep in step with lib/auth/session.ts

export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, API routes (they answer 401 themselves) and static assets.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
