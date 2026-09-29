// Owner task: EB-92 Web auth — which sign-in mode is active, from environment only (secrets never in code).
//   oidc: KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_WEB_CLIENT_ID, KEYCLOAK_WEB_CLIENT_SECRET, APP_URL set.
//   dev:  `next dev` without Keycloak settings. Refused in production builds.
//   none: production without Keycloak settings: nobody can sign in (fail closed).

export type AuthMode = "oidc" | "dev" | "none";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  appUrl: string;
}

export function oidcConfig(): OidcConfig | null {
  const url = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM;
  const clientId = process.env.KEYCLOAK_WEB_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_WEB_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!url || !realm || !clientId || !clientSecret || !appUrl) return null;
  return { issuer: `${url.replace(/\/$/, "")}/realms/${realm}`, clientId, clientSecret, appUrl: appUrl.replace(/\/$/, "") };
}

export function authMode(): AuthMode {
  if (oidcConfig()) return "oidc";
  return process.env.NODE_ENV === "production" ? "none" : "dev";
}

/** Signing secret for session cookies. Production must set SESSION_SECRET (32+ chars). */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) is required in production");
  return "development-only-session-secret-not-for-production";
}

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
