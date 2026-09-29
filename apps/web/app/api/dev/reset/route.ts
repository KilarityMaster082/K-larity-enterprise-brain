// Owner task: EB-98 UI tests — development-only: forget all in-memory tenant state so an end-to-end run starts
// from the seed data. Does nothing (404) outside `next dev`.
import { NextResponse } from "next/server";

import { authMode } from "@/lib/auth/config";
import { resetStore } from "@/lib/data/store";

export async function POST() {
  if (authMode() !== "dev") return new NextResponse(null, { status: 404 });
  resetStore();
  return NextResponse.json({ ok: true });
}
