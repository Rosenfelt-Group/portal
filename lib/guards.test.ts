import { describe, it, expect } from "vitest";
import { isSameOriginJson } from "./guards";

const O = "https://portal.rosably.com";
const req = (h: Record<string, string>) => new Request(`${O}/api/room/identify`, { method: "POST", headers: h });

describe("isSameOriginJson", () => {
  it("accepts the portal origin with JSON", () => {
    expect(isSameOriginJson(req({ origin: O, "content-type": "application/json" }), O)).toBe(true);
    expect(isSameOriginJson(req({ origin: O, "content-type": "application/json; charset=utf-8" }), O)).toBe(true);
  });
  it("rejects missing, null, foreign and look-alike origins and non-JSON bodies", () => {
    for (const h of [
      { "content-type": "application/json" },
      { origin: "null", "content-type": "application/json" },
      { origin: "https://evil.example", "content-type": "application/json" },
      { origin: "https://portal.rosably.com.evil.example", "content-type": "application/json" },
      { origin: "http://portal.rosably.com", "content-type": "application/json" },
      { origin: O, "content-type": "text/plain" },
      { origin: O, "content-type": "application/x-www-form-urlencoded" },
      { origin: O },
    ] as Record<string, string>[]) expect(isSameOriginJson(req(h), O)).toBe(false);
  });
});
