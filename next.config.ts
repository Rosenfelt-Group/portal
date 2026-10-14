import type { NextConfig } from "next";

const previewOrigin = new URL(process.env.NEXT_PUBLIC_PREVIEW_URL || "https://preview.rosably.com").origin;
const csp = `frame-ancestors 'none'; frame-src ${previewOrigin}; base-uri 'none'; object-src 'none'; form-action 'self'`;
const noStore = [{ key: "Cache-Control", value: "private, no-store" }];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Room tokens live in URLs; never leak them via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      { source: "/api/:path*", headers: noStore },
      { source: "/room", headers: noStore },
      { source: "/r/:path*", headers: noStore },
      { source: "/link-expired", headers: noStore },
    ];
  },
};

export default nextConfig;
