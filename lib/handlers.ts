import { getQ } from "./db";
import { openRoom, getSessionRow, identify, listDeliverables, versionForPreview, documentForDownload, type Q, type RoomHeader, type DeliverableRow, type DocumentRow } from "./queries";
import { isTokenShape, hashToken } from "./token";
import { signSession, verifySession, sessionExpiry, setCookieHeader, type SessionPayload } from "./session";
import { isSameOriginJson } from "./guards";
import { signGrant, signDocGrant, isSafeDocFilename, GRANT_TTL_SEC } from "./grant";

export interface Deps {
  q: Q; sessionSecret: string; grantSecret: string; previewUrl: string; portalOrigin: string; now?: () => number;
}

export function depsFromEnv(): Deps {
  return {
    // Lazy: getQ() throws if PORTAL_DATABASE_URL is unset; defer so handlers' try/catch fail closed.
    q: ((strings: TemplateStringsArray, ...values: unknown[]) => getQ()(strings, ...values)) as Q,
    sessionSecret: process.env.ROOM_SESSION_SECRET ?? "",
    grantSecret: process.env.ROOM_GRANT_SECRET ?? "",
    previewUrl: (process.env.NEXT_PUBLIC_PREVIEW_URL || "https://preview.rosably.com").replace(/\/+$/, ""),
    portalOrigin: process.env.PORTAL_ORIGIN ?? "https://portal.rosably.com",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nowMs = (d: Deps) => (d.now ? d.now() : Date.now());

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", ...extra },
  });

const expired = () => new Response(null, { status: 303, headers: { Location: "/link-expired", "Cache-Control": "private, no-store" } });

// Signs a renewed session cookie (sliding idle timeout, capped at st + 8h and the link expiry).
function sessionCookie(p: { aid: string; eid: string; cid?: string; st: number }, linkExpiresAt: string | Date, d: Deps): string | null {
  const now = nowMs(d);
  const exp = sessionExpiry(linkExpiresAt, p.st, now);
  if (!Number.isInteger(exp) || exp * 1000 <= now) return null;
  const payload: SessionPayload = p.cid ? { aid: p.aid, eid: p.eid, cid: p.cid, st: p.st, exp } : { aid: p.aid, eid: p.eid, st: p.st, exp };
  return setCookieHeader(signSession(payload, d.sessionSecret), exp - Math.floor(now / 1000));
}

export async function handleOpen(token: string, d: Deps): Promise<Response> {
  if (!isTokenShape(token)) return expired();
  if (!d.sessionSecret) return expired();
  let row: RoomHeader | null;
  try { row = await openRoom(d.q, hashToken(token)); } catch { return expired(); }
  if (!row) return expired();
  const st = Math.floor(nowMs(d) / 1000);
  const setCookie = sessionCookie({ aid: row.access_id, eid: row.engagement_id, st }, row.expires_at, d);
  if (!setCookie) return expired();
  return new Response(null, {
    status: 303,
    headers: { Location: "/room", "Cache-Control": "private, no-store", "Set-Cookie": setCookie },
  });
}

export async function requireSession(cookie: string | undefined, d: Deps): Promise<{ s: SessionPayload; row: RoomHeader; renewed: string } | null> {
  const s = verifySession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  let row: RoomHeader | null;
  try { row = await getSessionRow(d.q, s.aid, s.eid, s.cid); } catch { return null; }
  if (!row) return null;
  const renewed = sessionCookie(s, row.expires_at, d);
  return renewed ? { s, row, renewed } : null;
}

export async function handleIdentify(req: Request, cookie: string | undefined, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  const sess = await requireSession(cookie, d);
  if (!sess) return json({ error: "Session expired." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = body as { name?: unknown; email?: unknown } | null;
  const bad = () => json({ error: "Please check your name and email." }, 400, { "Set-Cookie": sess.renewed });
  if (!b || typeof b !== "object" || typeof b.name !== "string" || typeof b.email !== "string") return bad();
  if (b.name.length > 200 || b.email.length > 300) return bad();
  let cid: string | null;
  try { cid = await identify(d.q, sess.s.aid, sess.s.eid, b.name, b.email); } catch { return bad(); }
  if (!cid) return bad();
  const setCookie = sessionCookie({ aid: sess.s.aid, eid: sess.s.eid, cid, st: sess.s.st }, sess.row.expires_at, d);
  if (!setCookie) return json({ error: "Session expired." }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": setCookie });
}

export async function handleDeliverables(cookie: string | undefined, d: Deps): Promise<Response> {
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  let rows: DeliverableRow[];
  try { rows = await listDeliverables(d.q, sess.s.aid, sess.s.eid); } catch { return json({ error: "Not available." }, 500, { "Set-Cookie": sess.renewed }); }
  const byId = new Map<string, { id: string; title: string; description: string | null; kind: string; welcome_message: string | null; versions: unknown[] }>();
  for (const r of rows) {
    if (!byId.has(r.deliverable_id)) {
      byId.set(r.deliverable_id, {
        id: r.deliverable_id, title: r.deliverable_title, description: r.description,
        kind: r.kind === "document" ? "document" : "prototype",
        welcome_message: typeof r.welcome_message === "string" ? r.welcome_message : null,
        versions: [],
      });
    }
    byId.get(r.deliverable_id)!.versions.push({
      id: r.version_id, version_no: r.version_no, status: r.status, shared_at: r.shared_at,
      created_at: isoOrNull(r.created_at),
      change_summary: r.change_summary, screens: Array.isArray(r.screens) ? r.screens : [], document: docInfo(r.document),
    });
  }
  return json({ deliverables: [...byId.values()] }, 200, { "Set-Cookie": sess.renewed });
}

// Whitelists the document fields so nothing internal (storage path, manifest extras) reaches the browser.
function docInfo(x: unknown): { filename: string; ext: string; size: number } | null {
  if (!x || typeof x !== "object") return null;
  const { filename, ext, size } = x as Record<string, unknown>;
  if (typeof filename !== "string" || typeof ext !== "string" || typeof size !== "number") return null;
  return { filename, ext, size };
}

// A valid string passes through; a Date becomes ISO; anything unparseable becomes null (never throws).
function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return null;
  return typeof v === "string" ? v : new Date(t).toISOString();
}

function entryPath(entry: unknown): string {
  if (typeof entry !== "string" || !entry) return "index.html";
  const segs = entry.split("/");
  if (segs.some(s => s === "" || s === "." || s === ".." || s.startsWith("."))) return "index.html";
  return segs.map(encodeURIComponent).join("/");
}

export async function handlePreviewUrl(cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  let row;
  try { row = await versionForPreview(d.q, sess.s.aid, sess.s.eid, sess.s.cid, versionId); } catch { return json({ error: "Not available." }, 404, { "Set-Cookie": sess.renewed }); }
  if (!row) return json({ error: "Not available." }, 404, { "Set-Cookie": sess.renewed });
  let grant: string;
  try { grant = signGrant(row.storage_prefix, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404, { "Set-Cookie": sess.renewed }); }
  return json({ url: `${d.previewUrl}/v/${grant}/${entryPath(row.entry)}`, expiresInSec: GRANT_TTL_SEC }, 200, { "Set-Cookie": sess.renewed });
}

// The download name must end in the stored file's extension (document.<ext>); otherwise use the stored name.
// The extension is compared after normalisation (.jpeg == .jpg, case-insensitive).
function normExt(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  if (!m) return null;
  const e = m[1].toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}
function downloadName(file: string, filename: unknown): string {
  if (!isSafeDocFilename(filename)) return file;
  const want = normExt(file);
  return want !== null && normExt(filename) === want ? filename : file;
}

// POST: a 2-minute download URL on the preview host for a shared document. The portal never touches
// Storage; the preview host verifies the document grant and streams the file as an attachment.
// The URL is returned to the caller only and is never logged.
export async function handleDocumentUrl(req: Request, cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  const renew = { "Set-Cookie": sess.renewed };
  let row: DocumentRow | null;
  try { row = await documentForDownload(d.q, sess.s.aid, sess.s.eid, sess.s.cid, versionId); } catch { return json({ error: "Not available." }, 404, renew); }
  if (!row || typeof row.file !== "string" || typeof row.storage_prefix !== "string") return json({ error: "Not available." }, 404, renew);
  let grant: string;
  try { grant = signDocGrant(`${row.storage_prefix}/${row.file}`, downloadName(row.file, row.filename), d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404, renew); }
  return json({ url: `${d.previewUrl}/d/${grant}` }, 200, renew);
}
