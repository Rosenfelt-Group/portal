import { describe, it, expect, vi } from "vitest";
import { handleOpen, handleIdentify, handleDeliverables, handlePreviewUrl, handleDocumentUrl, requireSession, depsFromEnv, type Deps } from "./handlers";
import { signSession, verifySession, COOKIE_NAME } from "./session";
import { hashToken } from "./token";
import { verifyGrant, verifyDocGrant } from "./grant";
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
const goodCookie = (extra: object = {}) => cookie({ aid: A, eid: E, st: NOW / 1000 - 60, exp: NOW / 1000 + 3000, ...extra });

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
    expect(p.st).toBe(Math.floor(NOW / 1000));
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
    expect(await requireSession(cookie({ aid: A, eid: E, st: NOW / 1000 - 600, exp: NOW / 1000 - 10 }), d)).toBeNull();
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
  it("identifies, then re-signs the cookie with the contact and a renewed expiry", async () => {
    const { d } = deps((t) => (t.includes("portal_session") ? [header] : t.includes("portal_identify") ? [{ portal_identify: C }] : []));
    const r = await handleIdentify(req({ name: "Pat", email: "pat@x.co" }), goodCookie(), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const value = r.headers.get("set-cookie")!.split(";")[0].slice(COOKIE_NAME.length + 1);
    expect(verifySession(value, SESSION_SECRET, NOW)).toMatchObject({ aid: A, eid: E, cid: C, st: NOW / 1000 - 60, exp: NOW / 1000 + 3600 });
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
  it("returns kind, welcome message, created_at and safe document info, and nothing internal", async () => {
    const rows = [
      { deliverable_id: "d2", deliverable_title: "Proposal", description: null, kind: "document", welcome_message: "Hi\n<b>there</b>",
        version_id: "v9", version_no: 1, status: "shared", shared_at: "2026-10-14T10:00:00Z", created_at: "2026-10-14T09:00:00Z",
        change_summary: null, screens: [], document: { filename: "Proposal.pdf", ext: "pdf", size: 1234, extra: "x" }, storage_prefix: "SECRET" },
      { deliverable_id: "d1", deliverable_title: "App", description: null, kind: "prototype", welcome_message: null,
        version_id: "v1", version_no: 1, status: "shared", shared_at: null, created_at: "2026-10-13T09:00:00Z",
        change_summary: null, screens: [], document: null },
    ];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const body = await (await handleDeliverables(goodCookie({ cid: C }), d)).json();
    expect(body.deliverables[0]).toMatchObject({ id: "d2", kind: "document", welcome_message: "Hi\n<b>there</b>" });
    expect(body.deliverables[0].versions[0]).toMatchObject({ created_at: "2026-10-14T09:00:00Z", document: { filename: "Proposal.pdf", ext: "pdf", size: 1234 } });
    expect(body.deliverables[0].versions[0].document).not.toHaveProperty("extra");
    expect(body.deliverables[1]).toMatchObject({ kind: "prototype", welcome_message: null });
    expect(body.deliverables[1].versions[0].document).toBeNull();
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
  it("defaults kind to prototype for rows from an older database function", async () => {
    const rows = [{ deliverable_id: "d1", deliverable_title: "App", description: null, version_id: "v1", version_no: 1, status: "shared", shared_at: null, change_summary: null, screens: [] }];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const body = await (await handleDeliverables(goodCookie({ cid: C }), d)).json();
    expect(body.deliverables[0]).toMatchObject({ kind: "prototype", welcome_message: null });
    expect(body.deliverables[0].versions[0]).toMatchObject({ created_at: null, document: null });
  });
  it("survives hostile rows: bad created_at, Date objects, null screens on documents, odd welcome text", async () => {
    const long = "x".repeat(1000);
    const rows = [
      { deliverable_id: "d1", deliverable_title: "A", description: null, kind: "document", welcome_message: `<script>alert(1)</script>\r\n${long}`,
        version_id: "v1", version_no: 1, status: "shared", shared_at: null, created_at: "garbage", change_summary: null, screens: null, document: { filename: 5, ext: "pdf", size: 1 } },
      { deliverable_id: "d1", deliverable_title: "A", description: null, kind: "weird", welcome_message: 42,
        version_id: "v2", version_no: 2, status: "shared", shared_at: null, created_at: new Date("2026-10-14T09:00:00Z"), change_summary: null, screens: null, document: "str" },
      { deliverable_id: "d1", deliverable_title: "A", description: null, version_id: "v3", version_no: 3, status: "shared", shared_at: null,
        created_at: new Date("nope"), change_summary: null, screens: [], document: null },
    ];
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : rows));
    const r = await handleDeliverables(goodCookie({ cid: C }), d);
    expect(r.status).toBe(200);
    const body = await r.json();
    const dl = body.deliverables[0];
    expect(dl.kind).toBe("document");
    expect(dl.welcome_message).toContain("<script>");
    const [v1, v2, v3] = dl.versions;
    expect(v1).toMatchObject({ created_at: null, screens: [], document: null });
    expect(v2).toMatchObject({ created_at: "2026-10-14T09:00:00.000Z", screens: [], document: null });
    expect(v3.created_at).toBeNull();
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

describe("fail closed when the database throws", () => {
  const boom = () => { throw new Error("db down"); };
  const mk = () => deps(boom).d;
  const idReq = new Request(`${ORIGIN}/api/room/identify`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ name: "Pat", email: "pat@x.co" }) });
  it("requireSession returns null", async () => {
    expect(await requireSession(goodCookie(), mk())).toBeNull();
  });
  it("handleOpen redirects to /link-expired without a cookie", async () => {
    const r = await handleOpen(TOKEN, mk());
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/link-expired");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("handleIdentify does not succeed or set a cookie", async () => {
    const r = await handleIdentify(idReq, goodCookie(), mk());
    expect(r.status).not.toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("handleIdentify fails when identify itself throws after a valid session", async () => {
    const { d } = deps((t) => { if (t.includes("portal_session")) return [header]; throw new Error("x"); });
    const r = await handleIdentify(idReq, goodCookie(), d);
    expect(r.status).not.toBe(200);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("handleDeliverables is non-200", async () => {
    expect((await handleDeliverables(goodCookie({ cid: C }), mk())).status).not.toBe(200);
  });
  it("handlePreviewUrl is 404 when the preview lookup throws", async () => {
    const { d } = deps((t) => { if (t.includes("portal_session")) return [{ ...header, contact_id: C }]; throw new Error("x"); });
    expect((await handlePreviewUrl(goodCookie({ cid: C }), V, d)).status).toBe(404);
  });
});

describe("handleOpen misconfiguration", () => {
  it("makes no query when sessionSecret is empty", async () => {
    const { d, calls } = deps(() => [header]);
    const r = await handleOpen(TOKEN, { ...d, sessionSecret: "" });
    expect(r.headers.get("location")).toBe("/link-expired");
    expect(calls).toEqual([]);
  });
  it("depsFromEnv does not throw without PORTAL_DATABASE_URL and fails closed", async () => {
    const saved = process.env.PORTAL_DATABASE_URL;
    delete process.env.PORTAL_DATABASE_URL;
    try {
      const d = depsFromEnv();
      const r = await handleOpen(TOKEN, { ...d, sessionSecret: SESSION_SECRET });
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/link-expired");
    } finally { if (saved !== undefined) process.env.PORTAL_DATABASE_URL = saved; }
  });
});

describe("entry path fallbacks", () => {
  it("falls back to index.html for dotted segments and trailing slash", async () => {
    const prefix = `${E}/${A}/v2`;
    for (const entry of ["a/.x.html", "./x", "a/"]) {
      const { d } = deps((t) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : [{ storage_prefix: prefix, entry, deliverable_id: A, version_no: 2 }]));
      const { url } = await (await handlePreviewUrl(goodCookie({ cid: C }), V, d)).json();
      expect(url.endsWith("/index.html")).toBe(true);
    }
  });
});

describe("sliding session", () => {
  const farHeader = { ...header, contact_id: C, expires_at: new Date(NOW + 30 * 86_400_000).toISOString() };
  const valueOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0].slice(COOKIE_NAME.length + 1);
  const sessionDeps = (h: object = farHeader) => deps((t) => (t.includes("portal_session") ? [h] : []));

  it("renews the cookie to now + 2 hours on an authenticated API call, keeping the start", async () => {
    const { d } = sessionDeps();
    const r = await handleDeliverables(goodCookie({ cid: C, exp: NOW / 1000 + 60 }), d);
    expect(r.status).toBe(200);
    const p = verifySession(valueOf(r), SESSION_SECRET, NOW)!;
    expect(p).toMatchObject({ aid: A, eid: E, cid: C, st: NOW / 1000 - 60, exp: NOW / 1000 + 7200 });
    expect(r.headers.get("set-cookie")).toContain("Max-Age=7200");
  });
  it("never renews past 8 hours from the start", async () => {
    const st = NOW / 1000 - 7.5 * 3600;
    const { d } = sessionDeps();
    const r = await handleDeliverables(goodCookie({ cid: C, st, exp: NOW / 1000 + 60 }), d);
    expect(verifySession(valueOf(r), SESSION_SECRET, NOW)!.exp).toBe(st + 8 * 3600);
  });
  it("never renews past the link expiry when it is sooner than the idle window", async () => {
    const { d } = sessionDeps({ ...farHeader, expires_at: new Date(NOW + 600_000).toISOString() });
    const r = await handleDeliverables(goodCookie({ cid: C }), d);
    expect(verifySession(valueOf(r), SESSION_SECRET, NOW)!.exp).toBe(NOW / 1000 + 600);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=600");
  });
  it("refuses when the link expired in the database, and when it expires exactly now", async () => {
    for (const ms of [-1000, 0]) {
      const { d } = sessionDeps({ ...farHeader, expires_at: new Date(NOW + ms).toISOString() });
      const r = await handleDeliverables(goodCookie({ cid: C }), d);
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });
  it("an idle-expired cookie is refused without a database call (exactly at expiry too)", async () => {
    for (const off of [-1, 0]) {
      const { d, calls } = deps(() => [farHeader]);
      expect((await handleDeliverables(goodCookie({ cid: C, exp: NOW / 1000 + off }), d)).status).toBe(401);
      expect(calls).toEqual([]);
    }
  });
  it("a Phase 2 cookie (no st) is refused without a database call", async () => {
    const { d, calls } = deps(() => [farHeader]);
    expect((await handleDeliverables(cookie({ aid: A, eid: E, cid: C, exp: NOW / 1000 + 600 }), d)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("refuses an st in the future, an exp beyond st + 8h, a session past 8h, and a tampered cookie", async () => {
    const { d, calls } = deps(() => [farHeader]);
    const s = NOW / 1000;
    for (const extra of [{ st: s + 120 }, { st: s - 60, exp: s - 60 + 8 * 3600 + 1 }, { st: s - 8 * 3600 - 1, exp: s + 10 }]) {
      expect((await handleDeliverables(goodCookie({ cid: C, ...extra }), d)).status).toBe(401);
    }
    const good = goodCookie({ cid: C });
    const tampered = good.slice(0, -2) + (good.endsWith("AA") ? "BB" : "AA");
    expect((await handleDeliverables(tampered, d)).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("preview-url also renews", async () => {
    const { d } = sessionDeps();
    const r = await handlePreviewUrl(goodCookie({ cid: C }), V, d);
    expect(r.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });
  it("identify keeps st and caps at st + 8h", async () => {
    const st = NOW / 1000 - 7.9 * 3600;
    const { d } = deps((t) => (t.includes("portal_session") ? [{ ...farHeader, contact_id: null }] : t.includes("portal_identify") ? [{ portal_identify: C }] : []));
    const idReq = new Request(`${ORIGIN}/api/room/identify`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ name: "Pat", email: "pat@x.co" }) });
    const r = await handleIdentify(idReq, goodCookie({ st, exp: NOW / 1000 + 60 }), d);
    expect(r.status).toBe(200);
    expect(verifySession(valueOf(r), SESSION_SECRET, NOW)).toMatchObject({ st, exp: st + 8 * 3600 });
  });
});

describe("handleDocumentUrl", () => {
  const U = "4fad5042-6b7e-4f90-8ab2-3d4e5f607182";
  const prefix = `${E}/${A}/${U}`;
  const withContact = (t: string) => (t.includes("portal_session") ? [{ ...header, contact_id: C }] : undefined);
  const req = (h: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" }) =>
    new Request(`${ORIGIN}/api/room/versions/${V}/document-url`, { method: "POST", headers: h, body: "{}" });
  const urlFor = async (row: object) => {
    const { d } = deps((t) => withContact(t) ?? [row]);
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    return verifyDocGrant(url.match(/\/d\/([^/]+)$/)![1], GRANT_SECRET, NOW);
  };

  it("rejects cross-origin requests and bad ids before any database call", async () => {
    const { d, calls } = deps(() => []);
    expect((await handleDocumentUrl(req({ origin: "https://evil.example", "content-type": "application/json" }), goodCookie({ cid: C }), V, d)).status).toBe(403);
    expect((await handleDocumentUrl(req(), goodCookie({ cid: C }), "not-a-uuid", d)).status).toBe(404);
    expect(calls).toEqual([]);
  });
  it("requires a session with a contact", async () => {
    const { d } = deps(() => [header]);
    expect((await handleDocumentUrl(req(), goodCookie(), V, d)).status).toBe(401);
  });
  it("404s for a prototype, a draft or another engagement's version, still renewing the session", async () => {
    const { d } = deps((t) => withContact(t) ?? []);
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not available." });
    expect(r.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
  });
  it("returns a preview-host /d/ URL with a short-lived document grant for exactly that file", async () => {
    const { d, calls } = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, file: "document.pdf", filename: "Proposal.pdf" }]);
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    const m = url.match(/^https:\/\/preview\.rosably\.com\/d\/([^/]+)$/)!;
    expect(verifyDocGrant(m[1], GRANT_SECRET, NOW)).toEqual({ ok: true, path: `${prefix}/document.pdf`, filename: "Proposal.pdf", exp: NOW / 1000 + 120 });
    expect(calls.at(-1)!.values).toEqual([A, E, C, V]);
    expect(r.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
    expect(JSON.stringify(await (await handleDocumentUrl(req(), goodCookie({ cid: C }), V, d)).json())).not.toContain(prefix);
  });
  it("forces the download name's extension to the stored file's extension", async () => {
    const base = { storage_prefix: prefix, file: "document.pdf" };
    expect(await urlFor({ ...base, filename: "Proposal.exe" })).toMatchObject({ ok: true, filename: "document.pdf" });
    expect(await urlFor({ ...base, filename: "Proposal" })).toMatchObject({ ok: true, filename: "document.pdf" });
    expect(await urlFor({ ...base, filename: "Proposal.docx" })).toMatchObject({ ok: true, filename: "document.pdf" });
    expect(await urlFor({ ...base, filename: "Proposal.pdf.html" })).toMatchObject({ ok: true, filename: "document.pdf" });
    expect(await urlFor({ ...base, filename: null })).toMatchObject({ ok: true, filename: "document.pdf" });
    expect(await urlFor({ ...base, filename: "Quarterly.PDF" })).toMatchObject({ ok: true, filename: "Quarterly.PDF" });
  });
  it("404s when the stored filename or path is unsafe, and when the database throws", async () => {
    const bad = deps((t) => withContact(t) ?? [{ storage_prefix: prefix, file: "../x.pdf", filename: "a.pdf" }]);
    expect((await handleDocumentUrl(req(), goodCookie({ cid: C }), V, bad.d)).status).toBe(404);
    const boom = deps((t) => { if (t.includes("portal_session")) return [{ ...header, contact_id: C }]; throw new Error("db"); });
    const r = await handleDocumentUrl(req(), goodCookie({ cid: C }), V, boom.d);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not available." });
  });
});
