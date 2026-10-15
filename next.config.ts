import type { NextConfig } from "next";

const previewOrigin = new URL(process.env.NEXT_PUBLIC_PREVIEW_URL || "https://preview.rosably.com").origin;
const csp = `frame-ancestors 'none'; frame-src ${previewOrigin}; base-uri 'none'; object-src 'none'; form-action 'self'`;
// Document downloads need no CSP change: the page only navigates (window.location.assign) to the preview host's
// /d/<grant> URL, which answers with Content-Disposition: attachment. Documents are never framed or fetched here,
// so frame-src stays limited to the preview origin for prototypes and there is no connect-src/default-src to widen.
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
      { source: "/preview", headers: noStore },
      { source: "/preview/:path*", headers: noStore },
    ];
  },
};

export default nextConfig;
