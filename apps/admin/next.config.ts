// Owner task: EB-100 Admin console shell — the K!larity operator console (never exposed to tenants).
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@klarity/ui", "@klarity/web-auth"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
