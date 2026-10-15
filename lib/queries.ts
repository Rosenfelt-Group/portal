import type { Q } from "./db";
export type { Q } from "./db";

export interface RoomHeader {
  access_id: string; engagement_id: string; expires_at: string | Date; title: string;
  relationship: string; org_name: string; modules: Record<string, unknown>;
  contact_id?: string | null; contact_name?: string | null;
}
export interface DeliverableRow {
  deliverable_id: string; deliverable_title: string; description: string | null;
  kind?: string; welcome_message?: string | null;
  version_id: string; version_no: number; status: string; shared_at: string | null; created_at?: string | Date | null;
  change_summary: string | null; screens: { id: string; name: string }[] | null; document?: unknown;
}
export interface PreviewRow { storage_prefix: string; entry: string | null; deliverable_id: string; version_no: number }

export async function openRoom(q: Q, hash: string): Promise<RoomHeader | null> {
  const rows = await q<RoomHeader>`select * from rooms.portal_open_room(${hash})`;
  return rows[0] ?? null;
}

export async function getSessionRow(q: Q, aid: string, eid: string, cid: string | undefined): Promise<RoomHeader | null> {
  const rows = await q<RoomHeader>`select * from rooms.portal_session(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid)`;
  return rows[0] ?? null;
}

export async function identify(q: Q, aid: string, eid: string, name: string, email: string): Promise<string | null> {
  const rows = await q<{ portal_identify: string | null }>`select rooms.portal_identify(${aid}::uuid, ${eid}::uuid, ${name}, ${email})`;
  return rows[0]?.portal_identify ?? null;
}

export async function listDeliverables(q: Q, aid: string, eid: string): Promise<DeliverableRow[]> {
  return q<DeliverableRow>`select * from rooms.portal_list_deliverables(${aid}::uuid, ${eid}::uuid)`;
}

export async function versionForPreview(q: Q, aid: string, eid: string, cid: string | undefined, versionId: string): Promise<PreviewRow | null> {
  const rows = await q<PreviewRow>`select * from rooms.portal_version_for_preview(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}

export interface DocumentRow { storage_prefix: string; file: string; filename: string }

export async function documentForDownload(q: Q, aid: string, eid: string, cid: string | undefined, versionId: string): Promise<DocumentRow | null> {
  const rows = await q<DocumentRow>`select * from rooms.portal_document_for_download(${aid}::uuid, ${eid}::uuid, ${cid ?? null}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}

export interface PreviewRoomRow { engagement_id: string; title: string; relationship: string; org_name: string; status: string }
export interface PreviewVersionRow { kind: "prototype" | "document"; storage_prefix: string; entry: string | null; file: string | null; filename: string | null }

export async function previewRoom(q: Q, eid: string): Promise<PreviewRoomRow | null> {
  const rows = await q<PreviewRoomRow>`select * from rooms.preview_room(${eid}::uuid)`;
  return rows[0] ?? null;
}
export async function previewListDeliverables(q: Q, eid: string): Promise<DeliverableRow[]> {
  return q<DeliverableRow>`select * from rooms.preview_list_deliverables(${eid}::uuid)`;
}
export async function previewVersion(q: Q, eid: string, versionId: string): Promise<PreviewVersionRow | null> {
  const rows = await q<PreviewVersionRow>`select * from rooms.preview_version(${eid}::uuid, ${versionId}::uuid)`;
  return rows[0] ?? null;
}
