// Owner task: EB-23 Web UI shell — theme preference, stored in a cookie so the server renders it (no flash).
export const THEME_COOKIE = "kb-theme";
export type ThemePref = "light" | "dark";

export function parseTheme(v: string | undefined): ThemePref | undefined {
  return v === "light" || v === "dark" ? v : undefined;
}
