// Owner task: EB-98 UI tests — development-only: reset the operator console's in-memory data to its seed.
import { NextResponse } from "next/server";

import { resetAdminData } from "@/lib/data";
import { adminAuthMode } from "@/lib/session";

export async function POST() {
  if (adminAuthMode() !== "dev") return new NextResponse(null, { status: 404 });
  resetAdminData();
  return NextResponse.json({ ok: true });
}
