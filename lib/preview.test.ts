import { describe, it, expect } from "vitest";
import { signPreviewSession, verifyPreviewSession, previewCookieHeader, PREVIEW_COOKIE, PREVIEW_SESSION_SEC } from "./preview";
import { signSession, verifySession } from "./session";

const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const SECRET = "s".repeat(32);
const NOW = 1_800_000_000_000;

describe("preview session", () => {
  it("round-trips and expires", () => {
    const v = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(v, SECRET, NOW)).toEqual({ eid: E, exp: NOW / 1000 + 100 });
    expect(verifyPreviewSession(v, SECRET, NOW + 101_000)).toBeNull();
  });
  it("rejects tampering, the wrong secret, junk, and an exp beyond one hour", () => {
    const v = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(v, "other", NOW)).toBeNull();
    expect(verifyPreviewSession(v.slice(0, -2) + "xx", SECRET, NOW)).toBeNull();
    for (const bad of [undefined, "", "a", "a.b.c", "x".repeat(2000)]) expect(verifyPreviewSession(bad, SECRET, NOW)).toBeNull();
    const long = signPreviewSession({ eid: E, exp: NOW / 1000 + PREVIEW_SESSION_SEC + 60 }, SECRET);
    expect(verifyPreviewSession(long, SECRET, NOW)).toBeNull();
  });
  it("is not interchangeable with a visitor session, in either direction", () => {
    const pv = signPreviewSession({ eid: E, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifySession(pv, SECRET, NOW)).toBeNull();
    const visitor = signSession({ aid: A, eid: E, st: NOW / 1000 - 10, exp: NOW / 1000 + 100 }, SECRET);
    expect(verifyPreviewSession(visitor, SECRET, NOW)).toBeNull();
  });
  it("builds a __Host- cookie header", () => {
    const h = previewCookieHeader("val", 3600);
    expect(h).toBe(`${PREVIEW_COOKIE}=val; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`);
    expect(PREVIEW_COOKIE.startsWith("__Host-")).toBe(true);
  });
});
