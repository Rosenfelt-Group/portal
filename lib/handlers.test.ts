import { describe, it, expect, vi } from "vitest";
import { handleOpen, handleIdentify, handleDeliverables, handlePreviewUrl, requireSession, type Deps } from "./handlers";
import { signSession, verifySession, COOKIE_NAME } from "./session";
import { hashToken } from "./token";
import { verifyGrant } from "./grant";
import type { Q } from "./queries";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const TOKEN = "t".repeat(43);
const NOW = 1_800_000_000_000;
const SESSION_SECRET = "s".repeat(32);
const GRANT_SECRET = "g".repeat(32);
const ORIGIN = "https://portal.rosably.com";

const header = { access_id: A, engagement_id: E, expires_at: new Date(NOW + 3600_000).toISOString(),
  title: "Intake", relationship: "prospect", org_name: "Her Promise Circle", modules: { solutions: true },
  contact_id: null as string | null, contact_name: null as string | null };

function deps(script: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return script(text, values) ?? [];
  }) as unknown as Q;
  const d: Deps = { q, sessionSecret: SESSION_SECRET, grantSecret: GRANT_SECRET, previewUrl: "https://preview.rosably.com", portalOrigin: ORIGIN, now: () => NOW };
  return { d, calls };
}
const cookie = (p: object) => signSession(p as never, SESSION_SECRET);
const goodCookie = (extra: object = {}) => cookie({ aid: A, eid: E, exp: NOW / 1000 + 3000, ...extra });

describe("handleOpen", () => {
  it("sends malformed tokens to /link-expired without touching the database", async () => {
    const { d, calls } = deps(() => []);
    for (const bad of ["", "short", "a".repeat(44), "../etc", TOKEN + "\n"]) {
      const r = await handleOpen(bad, d);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/link-expired");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    expect(calls).toEqual([]);
  });
  it("treats an unknown, revoked or expired link exactly like a malformed one", async () => {
    const { d, calls } = deps(() => []);
    const r = await handleOpen(TOKEN, d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/link-expired");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(calls[0].values).toEqual([hashToken(TOKEN)]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });
  it("sets the session cookie and redirects to /room for a valid link", async () => {
    const { d } = deps(() => [header]);
    const r = await handleOpen(TOKEN, d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/room");
    const sc = r.headers.get("set-cookie")!;
    expect(sc.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    const value = sc.split(";")[0].slice(COOKIE_NAME.length + 1);
    const p = verifySession(value, SESSION_SECRET, NOW)!;
    expect(p).toMatchObject({ aid: A, eid: E });
    expect(p.exp).toBe(Math.floor(NOW / 1000) + 3600);
    expect(sc).not.toContain(TOKEN);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("requireSession", () => {
  it("rejects missing, forged and expired cookies without a database call", async () => {
    const { d, calls } = deps(() => [header]);
    expect(await requireSession(undefined, d)).toBeNull();
    expect(await requireSession("garbage", d)).toBeNull();
    expect(await requireSession(cookie({ aid: A, eid: E, exp: NOW / 1000 - 10 }), d)).toBeNull();
    expect(calls).toEqual([]);
  });
  it("rejects a validly signed cookie when the database says the link is no longer valid (revoked)", async () => {
    const { d } = deps(() => []);
    expect(await requireSession(goodCookie(), d)).toBeNull();
  });
  it("returns the header row for a valid session", async () => {
    const { d, calls } = deps(() => [header]);
    const s = await requireSession(goodCookie({ cid: C }), d);
    expect(s?.row.title).toBe("Intake");
    expect(calls[0].values).toEqual([A, E, C]);
  });
});

describe("handleIdentify", () => {
  const req = (body: unknown, h: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" }) =>
    new Request(`${ORIGIN}/api/room/identify`, { method: "POST", headers: h, body: JSON.stringify(body) });

  it("rejects cross-origin and non-JSON requests before anything else", async () => {
    const { d, calls } = deps(() => [header]);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }, { origin: "https://evil.example", "content-type": "application/json" }), goodCookie(), d)).status).toBe(403);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }, { origin: ORIGIN, "content-type": "text/plain" }), goodCookie(), d)).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("requires a session", async () => {
    const { d } = deps(() => []);
    expect((await handleIdentify(req({ name: "P", email: "p@x.co" }), undefined, d)).status).toBe(401);
  });
  it("validates the body without leaking details", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : []));
    for (const body of [{}, { name: 5, email: "a@b.co" }, { name: "P" }, { name: "P", email: "x".repeat(300) + "@b.co" }, "str", null]) {
      const r = await handleIdentify(req(body), goodCookie(), d);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "Please check your name and email." });
    }
  });
  it("identifies, then re-signs the cookie with the contact and the same expiry", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : t.includes("portal_identify") ? [{ portal_identify: C }] : []));
    const r = await handleIdentify(req({ name: "Pat", email: "pat@x.co" }), goodCookie(), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const value = r.headers.get("set-cookie")!.split(";")[0].slice(COOKIE_NAME.length + 1);
    expect(verifySession(value, SESSION_SECRET, NOW)).toMatchObject({ aid: A, eid: E, cid: C, exp: NOW / 1000 + 3000 });
  });
  it("returns the same generic 400 when the database rejects the introduction", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : [{ portal_identify: null }]));
    const r = await handleIdentify(req({ name: "Pat", email: "pat@x.co" }), goodCookie(), d);
    expect(r.status).toBe(400);
  });
});

describe("handleDeliverables", () => {
  it("requires a session and a contact", async () => {
    const { d } = deps(() => [header]);
    expect((await handleDeliverables(undefined, d)).status).toBe(401);
    expect((await handleDeliverables(goodCookie(), d)).status).toBe(401); // header has no contact_id yet
  });
  it("groups versions by deliverable and never exposes internal fields", async () => {
    const rows = [
      { deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v2", version_no: 2, status: "shared", shared_at: "2026-10-14T10:00:00Z", change_summary: "v2", screens: [{ id: "a", name: "A" }], storage_prefix: "SECRET/PREFIX/v2", manifest: { x: 1 } },
      { deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v1", version_no: 1, status: "superseded", shared_at: "2026-10-13T10:00:00Z", change_summary: null, screens: [] },
    ];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const r = await handleDeliverables(goodCookie({ cid: C }), d);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliverables).toHaveLength(1);
    expect(body.deliverables[0].versions.map((v: { version_no: number }) => v.version_no)).toEqual([2, 1]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
    expect(JSON.stringify(body)).not.toContain("storage_prefix");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handlePreviewUrl", () => {
  const withContact = (t: string) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : undefined);
  it("rejects bad ids without a database call and requires a session", async () => {
    const { d, calls } = deps(() => []);
    expect((await handlePreviewUrl(goodCookie({ cid: C }), "not-a-uuid", d)).status).toBe(404);
    expect((await handlePreviewUrl(undefined, V, d)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("returns 404 for a draft, another engagement's version or anything the database refuses", async () => {
    const { d } = deps((t) => withContact(t) ?? []);
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not available." });
  });
  it("signs a 15-minute grant for exactly the returned prefix and encodes the entry path", async () => {
    const prefix = `${E}/${A}/v2`;
    const { d, calls } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, entry: "pages/my page.html", deliverable_id: A, version_no: 2 }]);
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(200);
    const { url, expiresInSec } = await r.json();
    expect(expiresInSec).toBe(900);
    const m = url.match(/^https:\/\/preview\.rosably\.com\/v\/([^/]+)\/(.+)$/)!;
    expect(verifyGrant(m[1], GRANT_SECRET, NOW)).toMatchObject({ ok: true, prefix });
    expect(m[2]).toBe("pages/my%20page.html");
    expect(calls.at(-1)!.values).toEqual([A, E, C, V]);
  });
  it("falls back to index.html for a suspicious entry", async () => {
    const prefix = `${E}/${A}/v2`;
    for (const entry of ["../x.html", "", "a//b.html", ".hidden.html", null]) {
      const { d } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, entry, deliverable_id: A, version_no: 2 }]);
      const { url } = await (await handlePreviewUrl(goodCookie({ cid: C }), V, d)).json();
      expect(url.endsWith("/index.html")).toBe(true);
    }
  });
});
