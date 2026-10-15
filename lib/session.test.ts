import { describe, it, expect } from "vitest";
import { signSession, verifySession, sessionExpiry, setCookieHeader, clearCookieHeader, COOKIE_NAME, SESSION_MAX_SEC, SESSION_IDLE_SEC } from "./session";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;
const NOW_S = NOW / 1000;
const payload = { aid: A, eid: E, st: NOW_S - 60, exp: NOW_S + 3600 };

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
    for (const bad of [{ ...payload, aid: "nope" }, { ...payload, eid: 5 }, { ...payload, exp: "soon" }, { ...payload, cid: "bad" }, { aid: A, eid: E }, { ...payload, st: "x" }, { ...payload, st: 1.5 }, { aid: A, eid: E, exp: NOW_S + 3600 }]) {
      expect(verifySession(signSession(bad as never, SECRET), SECRET, NOW)).toBeNull();
    }
  });
  it("refuses to sign with an empty secret", () => {
    expect(() => signSession(payload, "")).toThrow();
    expect(verifySession(signSession(payload, SECRET), "", NOW)).toBeNull();
  });
  it("fails closed for a Phase 2 cookie without a start time", () => {
    expect(verifySession(signSession({ aid: A, eid: E, exp: NOW_S + 3600 } as never, SECRET), SECRET, NOW)).toBeNull();
  });
  it("rejects a start in the future, an expiry past the 8-hour cap, and a session older than 8 hours", () => {
    expect(verifySession(signSession({ ...payload, st: NOW_S + 120 }, SECRET), SECRET, NOW)).toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S - 60, exp: NOW_S - 60 + SESSION_MAX_SEC + 1 }, SECRET), SECRET, NOW)).toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S - SESSION_MAX_SEC - 1, exp: NOW_S + 10 }, SECRET), SECRET, NOW)).toBeNull();
  });
  it("tolerates up to 60 seconds of clock skew on the start time", () => {
    expect(verifySession(signSession({ ...payload, st: NOW_S + 30 }, SECRET), SECRET, NOW)).not.toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S + 60 }, SECRET), SECRET, NOW)).not.toBeNull();
    expect(verifySession(signSession({ ...payload, st: NOW_S + 61 }, SECRET), SECRET, NOW)).toBeNull();
  });
  it("accepts exp exactly at st + 8h and rejects exactly at the clock edge of expiry", () => {
    const st = NOW_S - 100;
    expect(verifySession(signSession({ ...payload, st, exp: st + SESSION_MAX_SEC }, SECRET), SECRET, NOW)).not.toBeNull();
    expect(verifySession(signSession(payload, SECRET), SECRET, payload.exp * 1000 - 1)).not.toBeNull();
    expect(verifySession(signSession(payload, SECRET), SECRET, payload.exp * 1000)).toBeNull();
  });
  it("rejects a tampered start time or MAC even with a valid-looking body", () => {
    const [, m] = signSession(payload, SECRET).split(".");
    const body = Buffer.from(JSON.stringify({ ...payload, st: payload.st + 3600, exp: payload.exp + 3600 })).toString("base64url");
    expect(verifySession(`${body}.${m}`, SECRET, NOW)).toBeNull();
    const v = signSession(payload, SECRET);
    expect(verifySession(v.slice(0, -2) + (v.endsWith("AA") ? "BB" : "AA"), SECRET, NOW)).toBeNull();
  });
  it("expires at the earliest of link expiry, 2 idle hours and 8 hours from the start", () => {
    const far = new Date(NOW + 30 * 86_400_000).toISOString();
    expect(sessionExpiry(far, NOW_S, NOW)).toBe(NOW_S + SESSION_IDLE_SEC);
    expect(sessionExpiry(new Date(NOW + 3600_000).toISOString(), NOW_S, NOW)).toBe(NOW_S + 3600);
    expect(sessionExpiry(far, NOW_S - 7 * 3600, NOW)).toBe(NOW_S - 7 * 3600 + SESSION_MAX_SEC);
    expect(sessionExpiry(far, NOW_S - 7 * 3600, NOW)).toBeLessThanOrEqual(NOW_S - 7 * 3600 + SESSION_MAX_SEC);
    expect(sessionExpiry(new Date(NOW).toISOString(), NOW_S, NOW)).toBe(NOW_S);
    expect(Number.isNaN(sessionExpiry("garbage", NOW_S, NOW))).toBe(true);
  });
  it("sets a __Host- cookie with the required attributes and no Domain", () => {
    const h = setCookieHeader("v", 600);
    expect(h.startsWith(`${COOKIE_NAME}=v;`)).toBe(true);
    for (const a of ["Path=/", "Max-Age=600", "HttpOnly", "Secure", "SameSite=Lax"]) expect(h).toContain(a);
    expect(h.toLowerCase()).not.toContain("domain");
    expect(clearCookieHeader()).toContain("Max-Age=0");
  });
});
