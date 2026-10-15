import { describe, it, expect } from "vitest";
import { handlePreviewOpen, requirePreview, handlePreviewDeliverables, handlePreviewUrl, handlePreviewDocumentUrl } from "./preview-handlers";
import { requireSession, handleDeliverables, type Deps } from "./handlers";
import { signPreviewToken, signGrant, signDocGrant, verifyGrant, verifyDocGrant } from "./grant";
import { signPreviewSession, PREVIEW_COOKIE } from "./preview";
import { signSession, COOKIE_NAME } from "./session";
import type { Q } from "./queries";

const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const NOW = 1_800_000_000_000;
const SESSION_SECRET = "s".repeat(32);
const GRANT_SECRET = "g".repeat(32);
const ORIGIN = "https://portal.rosably.com";
const room = { engagement_id: E, title: "Intake", relationship: "prospect", org_name: "Her Promise Circle", status: "active" };

function deps(script: (text: string, values: unknown[]) => unknown[] | undefined) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?"); calls.push({ text, values }); return script(text, values) ?? [];
  }) as unknown as Q;
  const d: Deps = { q, sessionSecret: SESSION_SECRET, grantSecret: GRANT_SECRET, previewUrl: "https://preview.rosably.com", portalOrigin: ORIGIN, now: () => NOW };
  return { d, calls };
}
const okDb = (text: string) => (text.includes("preview_room") ? [room] : undefined);
const previewCookie = () => signPreviewSession({ eid: E, exp: NOW / 1000 + 600 }, SESSION_SECRET);
const token = (over: { eid?: string; secret?: string; now?: number } = {}) => signPreviewToken(over.eid ?? E, over.secret ?? GRANT_SECRET, over.now ?? NOW);

describe("handlePreviewOpen", () => {
  it("exchanges a good token for the preview cookie and redirects to /preview", async () => {
    const { d, calls } = deps(okDb);
    const r = await handlePreviewOpen(token(), d);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/preview");
    const c = r.headers.get("set-cookie")!;
    expect(c.startsWith(`${PREVIEW_COOKIE}=`)).toBe(true);
    expect(c).toContain("HttpOnly"); expect(c).toContain("Secure"); expect(c).toContain("Max-Age=3600");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(calls[0].values).toContain(E);
  });
  it("issues a cookie that requirePreview accepts for its hour and rejects after", async () => {
    const { d } = deps(okDb);
    const c = (await handlePreviewOpen(token(), d)).headers.get("set-cookie")!;
    const value = c.slice(`${PREVIEW_COOKIE}=`.length).split(";")[0];
    expect(await requirePreview(value, d)).not.toBeNull();
    expect(await requirePreview(value, { ...d, now: () => NOW + 3599_000 })).not.toBeNull();
    expect(await requirePreview(value, { ...d, now: () => NOW + 3601_000 })).toBeNull();
  });
  it("sends bad, expired, wrong-kind and unknown-engagement tokens to /link-expired with no cookie", async () => {
    const { d } = deps(okDb);
    const proto = signGrant(`${E}/${D}/v1`, GRANT_SECRET, NOW);
    const doc = signDocGrant(`${E}/${D}/${V}/document.pdf`, "a.pdf", GRANT_SECRET, NOW);
    for (const t of ["", "garbage", token({ secret: "x".repeat(32) }), token({ now: NOW - 600_000 }), proto, doc, token().slice(0, -2) + "xx"]) {
      const r = await handlePreviewOpen(t, d);
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/link-expired");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    const none = deps(() => []);
    const r2 = await handlePreviewOpen(token(), none.d);
    expect(r2.headers.get("location")).toBe("/link-expired");
    expect(r2.headers.get("set-cookie")).toBeNull();
    const boom = deps(() => { throw new Error("db down"); });
    expect((await handlePreviewOpen(token(), boom.d)).headers.get("location")).toBe("/link-expired");
  });
  it("fails closed when a secret is missing", async () => {
    const { d } = deps(okDb);
    expect((await handlePreviewOpen(token(), { ...d, sessionSecret: "" })).headers.get("location")).toBe("/link-expired");
    expect((await handlePreviewOpen(token(), { ...d, grantSecret: "" })).headers.get("location")).toBe("/link-expired");
  });
});

describe("cookie separation", () => {
  it("a visitor cookie is refused by every preview endpoint, with no draft query run", async () => {
    const visitor = signSession({ aid: A, eid: E, cid: A, st: NOW / 1000 - 10, exp: NOW / 1000 + 600 }, SESSION_SECRET);
    const { d, calls } = deps(okDb);
    expect(await requirePreview(visitor, d)).toBeNull();
    expect((await handlePreviewDeliverables(visitor, d)).status).toBe(401);
    expect((await handlePreviewUrl(visitor, V, d)).status).toBe(401);
    const req = new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });
    expect((await handlePreviewDocumentUrl(req, visitor, V, d)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("the preview cookie is refused by the visitor session check and visitor deliverables handler", async () => {
    const { d, calls } = deps(okDb);
    expect(await requireSession(previewCookie(), d)).toBeNull();
    expect((await handleDeliverables(previewCookie(), d)).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(COOKIE_NAME).not.toBe(PREVIEW_COOKIE);
  });
});

describe("handlePreviewDeliverables", () => {
  it("lists drafts in the visitor payload shape and writes nothing", async () => {
    const row = { deliverable_id: D, deliverable_title: "App", description: null, kind: "prototype", welcome_message: "Hi", version_id: V, version_no: 1, status: "draft", shared_at: null, created_at: new Date(NOW).toISOString(), change_summary: null, screens: [{ id: "s1", name: "One" }], document: null };
    const { d, calls } = deps(t => (t.includes("preview_room") ? [room] : t.includes("preview_list_deliverables") ? [row] : undefined));
    const r = await handlePreviewDeliverables(previewCookie(), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = await r.json();
    expect(body.deliverables[0]).toMatchObject({ id: D, kind: "prototype", welcome_message: "Hi" });
    expect(body.deliverables[0].versions[0]).toMatchObject({ id: V, status: "draft" });
    expect(calls.some(c => /insert|update|delete/i.test(c.text))).toBe(false);
    expect(r.headers.get("set-cookie")).toBeNull(); // the preview session is never renewed
  });
  it("500s with a fixed message when the database fails", async () => {
    const { d } = deps(t => { if (t.includes("preview_list")) throw new Error("secret_table"); return [room]; });
    const r = await handlePreviewDeliverables(previewCookie(), d);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
});

describe("handlePreviewUrl and handlePreviewDocumentUrl", () => {
  const proto = { kind: "prototype", storage_prefix: `${E}/${D}/v2`, entry: "app.html", file: null, filename: null };
  const docRow = { kind: "document", storage_prefix: `${E}/${D}/${V}`, entry: null, file: "document.pdf", filename: "Proposal.pdf" };
  const dbWith = (vr: unknown) => deps(t => (t.includes("preview_room") ? [room] : t.includes("preview_version") ? [vr] : undefined));
  const post = () => new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" });

  it("returns a prototype grant URL for a draft prototype", async () => {
    const { d } = dbWith(proto);
    const r = await handlePreviewUrl(previewCookie(), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(url).toMatch(/^https:\/\/preview\.rosably\.com\/v\/[^/]+\/app\.html$/);
    expect(verifyGrant(url.split("/v/")[1].split("/")[0], GRANT_SECRET, NOW)).toMatchObject({ ok: true, prefix: `${E}/${D}/v2` });
  });
  it("returns a document download grant for a draft document", async () => {
    const { d } = dbWith(docRow);
    const r = await handlePreviewDocumentUrl(post(), previewCookie(), V, d);
    expect(r.status).toBe(200);
    const { url } = await r.json();
    expect(verifyDocGrant(url.split("/d/")[1], GRANT_SECRET, NOW)).toMatchObject({ ok: true, path: `${E}/${D}/${V}/document.pdf`, filename: "Proposal.pdf" });
  });
  it("404s the wrong kind, an unknown version and a malformed id; 403s a cross-origin POST", async () => {
    expect((await handlePreviewUrl(previewCookie(), V, dbWith(docRow).d)).status).toBe(404);
    expect((await handlePreviewDocumentUrl(post(), previewCookie(), V, dbWith(proto).d)).status).toBe(404);
    const none = deps(t => (t.includes("preview_room") ? [room] : []));
    expect((await handlePreviewUrl(previewCookie(), V, none.d)).status).toBe(404);
    expect((await handlePreviewUrl(previewCookie(), "nope", dbWith(proto).d)).status).toBe(404);
    const cross = new Request("https://portal.rosably.com/x", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect((await handlePreviewDocumentUrl(cross, previewCookie(), V, dbWith(docRow).d)).status).toBe(403);
  });
});
