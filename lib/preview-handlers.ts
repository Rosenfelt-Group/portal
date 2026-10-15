import { verifyPreviewToken, signGrant, signDocGrant, GRANT_TTL_SEC } from "./grant";
import { PREVIEW_SESSION_SEC, previewCookieHeader, signPreviewSession, verifyPreviewSession } from "./preview";
import { previewRoom, previewListDeliverables, previewVersion, type PreviewRoomRow, type DeliverableRow } from "./queries";
import { groupDeliverables, entryPath, downloadName, json, expired, nowMs, type Deps } from "./handlers";
import { isSameOriginJson } from "./guards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// GET /preview/<token>: exchange a dashboard-signed token for the separate preview cookie.
export async function handlePreviewOpen(token: string, d: Deps): Promise<Response> {
  if (!d.sessionSecret || !d.grantSecret) return expired();
  const t = verifyPreviewToken(token, d.grantSecret, nowMs(d));
  if (!t.ok) return expired();
  let row: PreviewRoomRow | null;
  try { row = await previewRoom(d.q, t.eid); } catch { return expired(); }
  if (!row) return expired();
  const exp = Math.floor(nowMs(d) / 1000) + PREVIEW_SESSION_SEC;
  const cookie = previewCookieHeader(signPreviewSession({ eid: t.eid, exp }, d.sessionSecret), PREVIEW_SESSION_SEC);
  return new Response(null, {
    status: 303,
    headers: { Location: "/preview", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": cookie },
  });
}

export async function requirePreview(cookie: string | undefined, d: Deps): Promise<{ eid: string; row: PreviewRoomRow } | null> {
  const s = verifyPreviewSession(cookie, d.sessionSecret, nowMs(d));
  if (!s) return null;
  try {
    const row = await previewRoom(d.q, s.eid);
    return row ? { eid: s.eid, row } : null;
  } catch { return null; }
}

const ended = () => json({ error: "Preview ended." }, 401);

export async function handlePreviewDeliverables(cookie: string | undefined, d: Deps): Promise<Response> {
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let rows: DeliverableRow[];
  try { rows = await previewListDeliverables(d.q, sess.eid); } catch { return json({ error: "Not available." }, 500); }
  return json({ deliverables: groupDeliverables(rows) }, 200);
}

export async function handlePreviewUrl(cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let row;
  try { row = await previewVersion(d.q, sess.eid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row || row.kind !== "prototype") return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signGrant(row.storage_prefix, d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/v/${grant}/${entryPath(row.entry)}`, expiresInSec: GRANT_TTL_SEC }, 200);
}

export async function handlePreviewDocumentUrl(req: Request, cookie: string | undefined, versionId: string, d: Deps): Promise<Response> {
  if (!isSameOriginJson(req, d.portalOrigin)) return json({ error: "Not allowed." }, 403);
  if (!UUID.test(versionId)) return json({ error: "Not available." }, 404);
  const sess = await requirePreview(cookie, d);
  if (!sess) return ended();
  let row;
  try { row = await previewVersion(d.q, sess.eid, versionId); } catch { return json({ error: "Not available." }, 404); }
  if (!row || row.kind !== "document" || typeof row.file !== "string") return json({ error: "Not available." }, 404);
  let grant: string;
  try { grant = signDocGrant(`${row.storage_prefix}/${row.file}`, downloadName(row.file, row.filename), d.grantSecret, nowMs(d)); } catch { return json({ error: "Not available." }, 404); }
  return json({ url: `${d.previewUrl}/d/${grant}` }, 200);
}
