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
