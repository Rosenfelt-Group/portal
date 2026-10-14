import { describe, it, expect } from "vitest";
import { signSession, verifySession, sessionExpiry, setCookieHeader, clearCookieHeader, COOKIE_NAME, SESSION_MAX_SEC } from "./session";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;
const payload = { aid: A, eid: E, exp: NOW / 1000 + 3600 };

describe("session cookie", () => {
  it("round-trips with and without a contact", () => {
    expect(verifySession(signSession(payload, SECRET), SECRET, NOW)).toEqual(payload);
    const withC = { ...payload, cid: C };
    expect(verifySession(signSession(withC, SECRET), SECRET, NOW)).toEqual(withC);
  });
  it("rejects a wrong secret, tampering, expiry, and malformed values", () => {
    const v = signSession(payload, SECRET);
    expect(verifySession(v, "x".repeat(32), NOW)).toBeNull();
    const [p, s] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, eid: A })).toString("base64url");
    expect(verifySession(`${forged}.${s}`, SECRET, NOW)).toBeNull();
    expect(verifySession(v, SECRET, (payload.exp + 1) * 1000)).toBeNull();
    for (const bad of [undefined, "", "a", "a.b", "a.b.c", `${p}.`, `.${s}`, "x".repeat(2000)]) {
      expect(verifySession(bad as string, SECRET, NOW)).toBeNull();
    }
  });
  it("rejects payloads with bad ids or extra types even when correctly signed", () => {
    for (const bad of [{ ...payload, aid: "nope" }, { ...payload, eid: 5 }, { ...payload, exp: "soon" }, { ...payload, cid: "bad" }, { aid: A, eid: E }]) {
      expect(verifySession(signSession(bad as never, SECRET), SECRET, NOW)).toBeNull();
    }
  });
  it("refuses to sign with an empty secret", () => {
    expect(() => signSession(payload, "")).toThrow();
    expect(verifySession(signSession(payload, SECRET), "", NOW)).toBeNull();
  });
  it("expires at the earlier of the link expiry and 8 hours", () => {
    const soon = new Date(NOW + 3600_000).toISOString();
    const later = new Date(NOW + 10 * 3600_000).toISOString();
    expect(sessionExpiry(soon, NOW)).toBe(Math.floor((NOW + 3600_000) / 1000));
    expect(sessionExpiry(later, NOW)).toBe(Math.floor(NOW / 1000) + SESSION_MAX_SEC);
  });
  it("sets a __Host- cookie with the required attributes and no Domain", () => {
    const h = setCookieHeader("v", 600);
    expect(h.startsWith(`${COOKIE_NAME}=v;`)).toBe(true);
    for (const a of ["Path=/", "Max-Age=600", "HttpOnly", "Secure", "SameSite=Lax"]) expect(h).toContain(a);
    expect(h.toLowerCase()).not.toContain("domain");
    expect(clearCookieHeader()).toContain("Max-Age=0");
  });
});
