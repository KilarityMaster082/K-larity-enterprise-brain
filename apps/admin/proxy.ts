// Owner task: EB-100 Admin console shell — send signed-out visitors to /login. UX gate only; every page and
// action verifies the signed operator session on the server.
import { NextResponse, type NextRequest } from "next/server";

const OP_COOKIE = "kb_op_session"; // keep in step with lib/session.ts

export function proxy(req: NextRequest) {
  if (req.cookies.has(OP_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
