import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "__Host-rooms-preview";
export const PREVIEW_SESSION_SEC = 3600; // fixed lifetime from the token exchange; never renewed

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Domain-separated from the visitor session MAC, so neither cookie can verify as the other.
const DOMAIN = "rooms-preview-session-v1\n";

export interface PreviewSession { eid: string; exp: number }

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(DOMAIN + body).digest("base64url");

export function signPreviewSession(p: PreviewSession, secret: string): string {
  if (!secret) throw new Error("session secret missing");
  const body = Buffer.from(JSON.stringify({ eid: p.eid, exp: p.exp }), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

export function verifyPreviewSession(value: string | undefined, secret: string, nowMs: number = Date.now()): PreviewSession | null {
  if (typeof value !== "string" || !secret || value.length > 512) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(mac(secret, parts[0]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const { eid, exp } = p as Record<string, unknown>;
  if (typeof eid !== "string" || !UUID.test(eid)) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  if (exp * 1000 > nowMs + (PREVIEW_SESSION_SEC + 30) * 1000) return null;
  return { eid, exp };
}

export function previewCookieHeader(value: string, maxAgeSec: number): string {
  return `${PREVIEW_COOKIE}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Lax`;
}
