"use client";
// Owner task: EB-23 Web UI shell — the active tenant id for client components (evidence cache keys, overlays).
// Display only: every request is authorised on the server from the signed session, never from this value.
import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext<string>("");

export function TenantProvider({ tenantId, children }: { tenantId: string; children: ReactNode }) {
  return <Ctx.Provider value={tenantId}>{children}</Ctx.Provider>;
}

export function useTenantId(): string {
  return useContext(Ctx);
}
