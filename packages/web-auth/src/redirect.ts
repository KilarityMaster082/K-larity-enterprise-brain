// Owner task: EB-92 Web auth (shared by apps/web and apps/admin) — only same-site relative paths are accepted as post-login destinations.
export function safeNext(next: unknown, fallback = "/ask"): string {
  const n = typeof next === "string" ? next : "";
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\") || n.includes("\n") || n.includes("\r")) return fallback;
  if (n.startsWith("/api/") || n.startsWith("/login")) return fallback;
  return n;
}
