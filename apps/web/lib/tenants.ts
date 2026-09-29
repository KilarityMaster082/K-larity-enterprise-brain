// Owner task: EB-92 Web auth — the tenants the web app knows about. Mirrors the control-plane registry seed
// (services/control-plane/control_plane/seed.py) until the web app can read the registry through apps/api.
// `orgAlias` is the Keycloak Organization alias that maps a token to a tenant (ADR-013).
export interface TenantInfo {
  tenantId: string;
  slug: string;
  name: string;
  orgAlias: string;
  status: "provisioning" | "active" | "suspended" | "offboarding" | "offboarded";
  isSynthetic: boolean;
}

export const TENANTS: TenantInfo[] = [
  { tenantId: "0fdc5142-8c25-41c5-aab4-0a88db52a5bf", slug: "studio8", name: "Studio 8 Hats", orgAlias: "studio8", status: "active", isSynthetic: false },
  { tenantId: "1bae9ff8-abf9-44bf-9b17-a5cb2c83d71b", slug: "synthetic-canary", name: "Synthetic canary", orgAlias: "synthetic-canary", status: "active", isSynthetic: true },
];

export function tenantByOrg(alias: string): TenantInfo | undefined {
  return TENANTS.find((t) => t.orgAlias === alias);
}

export function tenantById(id: string): TenantInfo | undefined {
  return TENANTS.find((t) => t.tenantId === id);
}
