import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LinkExpired from "@/app/link-expired/page";
import { IntroForm } from "@/components/IntroForm";
import { FrameLabel, welcomeText } from "@/components/RoomView";

describe("link-expired page", () => {
  const html = renderToStaticMarkup(<LinkExpired />);
  it("is friendly, links home, and reveals no reason", () => {
    expect(html).toContain("This link isn&#x27;t working");
    expect(html).toContain('href="https://rosably.com"');
    expect(html.toLowerCase()).not.toMatch(/revoked|expired because|invalid token|not found in/);
    expect(html).not.toContain("<script");
  });
});

describe("intro form", () => {
  it("collects name and email with labels and posts only to the same origin", () => {
    const html = renderToStaticMarkup(<IntroForm orgName="Her Promise Circle" />);
    expect(html).toContain("Her Promise Circle");
    expect(html).toMatch(/<label[^>]*>Your name/);
    expect(html).toMatch(/<label[^>]*>Your email/);
    expect(html).toContain('type="email"');
    expect(html).not.toMatch(/action="https?:/);
  });
});

describe("room view helpers", () => {
  it("labels the frame as untrusted content", () => {
    expect(renderToStaticMarkup(<FrameLabel />)).toContain("untrusted");
  });
  it("words the welcome by relationship and never claims verification", () => {
    expect(welcomeText("prospect")).toMatch(/prototype/i);
    expect(welcomeText("client")).toMatch(/project/i);
    expect(welcomeText("partner")).toMatch(/collaborat|shared/i);
    expect(welcomeText("whatever")).toBeTruthy();
  });
});

import { PreviewFrame, sortVersions, type Version } from "@/components/RoomView";
import nextConfig from "@/next.config";

describe("preview frame", () => {
  const html = renderToStaticMarkup(<PreviewFrame url="https://preview.rosably.com/v/g/index.html" />);
  it("is sandboxed exactly and never gets same-origin", () => {
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain('src="https://preview.rosably.com/v/g/index.html"');
  });
});

describe("sortVersions", () => {
  it("orders newest first numerically", () => {
    const v = (n: number) => ({ id: String(n), version_no: n } as Version);
    expect(sortVersions([v(9), v(10), v(2)]).map(x => x.version_no)).toEqual([10, 9, 2]);
  });
});

describe("next.config headers", () => {
  it("sets the security headers and no-store on room routes", async () => {
    const rules = await nextConfig.headers!();
    const forSource = (src: string) => rules.find(r => r.source === src)!.headers;
    const all = Object.fromEntries(forSource("/:path*").map(h => [h.key, h.value]));
    const csp = all["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src https://preview.rosably.com;");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(all["X-Frame-Options"]).toBe("DENY");
    expect(all["Referrer-Policy"]).toBe("no-referrer");
    for (const src of ["/room", "/r/:path*", "/link-expired", "/api/:path*"]) {
      expect(forSource(src)).toContainEqual({ key: "Cache-Control", value: "private, no-store" });
    }
  });
});
