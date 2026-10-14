import { getQ } from "./db";
import { openRoom, getSessionRow, identify, listDeliverables, versionForPreview, type Q, type RoomHeader, type DeliverableRow } from "./queries";
import { isTokenShape, hashToken } from "./token";
import { signSession, verifySession, sessionExpiry, setCookieHeader, type SessionPayload } from "./session";
import { isSameOriginJson } from "./guards";
import { signGrant, GRANT_TTL_SEC } from "./grant";

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

export async function handleOpen(token: string, d: Deps): Promise<Response> {
  if (!isTokenShape(token)) return expired();
  if (!d.sessionSecret) return expired();
  let row: RoomHeader | null;
  try { row = await openRoom(d.q, hashToken(token)); } catch { return expired(); }
  if (!row) return expired();
  const exp = sessionExpiry(row.expires_at, nowMs(d));
  const value = signSession({ aid: row.access_id, eid: row.engagement_id, exp }, d.sessionSecret);
  return new Response(null, {
    status: 303,
    headers: { Location: "/room", "Cache-Control": "private, no-store", "Set-Cookie": setCookieHeader(value, exp - Math.floor(nowMs(d) / 1000)) },
  });
}

export async function requireSession(cookie: string | undefined, d: Deps): Promise<{ s: SessionPayload; row: RoomHeader } | null> {
  const s = verifySession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  try {
    const row = await getSessionRow(d.q, s.aid, s.eid, s.cid);
    return row ? { s, row } : null;
  } catch { return null; }
}

export async function handleIdentify(req: Request, cookie: string | undefined, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  const sess = await requireSession(cookie, d);
  if (!sess) return json({ error: "Session expired." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const b = body as { name?: unknown; email?: unknown } | null;
  const bad = () => json({ error: "Please check your name and email." }, 400);
  if (!b || typeof b !== "object" || typeof b.name !== "string" || typeof b.email !== "string") return bad();
  if (b.name.length > 200 || b.email.length > 300) return bad();
  let cid: string | null;
  try { cid = await identify(d.q, sess.s.aid, sess.s.eid, b.name, b.email); } catch { return bad(); }
  if (!cid) return bad();
  const value = signSession({ aid: sess.s.aid, eid: sess.s.eid, cid, exp: sess.s.exp }, d.sessionSecret);
  return json({ ok: true }, 200, { "Set-Cookie": setCookieHeader(value, sess.s.exp - Math.floor(nowMs(d) / 1000)) });
}

export async function handleDeliverables(cookie: string | undefined, d: Deps): Promise<Response> {
  const sess = await requireSession(cookie, d);
  if (!sess || !sess.row.contact_id) return json({ error: "Session expired." }, 401);
  let rows: DeliverableRow[];
  try { rows = await listDeliverables(d.q, sess.s.aid, sess.s.eid); } catch { return json({ error: "Not available." }, 500); }
  const byId = new Map<string, { id: string; title: string; description: string | null; versions: unknown[] }>();
  for (const r of rows) {
    if (!byId.has(r.deliverable_id)) byId.set(r.deliverable_id, { id: r.deliverable_id, title: r.deliverable_title, description: r.description, versions: [] });
    byId.get(r.deliverable_id)!.versions.push({
      id: r.version_id, version_no: r.version_no, status: r.status, shared_at: r.shared_at,
      change_summary: r.change_summary, screens: r.screens ?? [],
    });
  }
  return json({ deliverables: [...byId.values()] }, 200);
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
  try { row = await versionForPreview(d.q, sess.s.aid, sess.s.eid, sess.s.cid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row) return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signGrant(row.storage_prefix, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/v/${grant}/${entryPath(row.entry)}`, expiresInSec: GRANT_TTL_SEC }, 200);
}
