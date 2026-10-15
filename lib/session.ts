import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "__Host-rooms";
export const SESSION_MAX_SEC = 8 * 3600;  // absolute cap, counted from when the link was opened (st)
export const SESSION_IDLE_SEC = 2 * 3600; // sliding idle timeout, renewed on every authenticated API call
const CLOCK_SKEW_SEC = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SessionPayload { aid: string; eid: string; cid?: string; st: number; exp: number }

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signSession(p: SessionPayload, secret: string): string {
  if (!secret) throw new Error("session secret missing");
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

export function verifySession(value: string | undefined, secret: string, nowMs: number = Date.now()): SessionPayload | null {
  if (typeof value !== "string" || !secret || value.length > 1024) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(mac(secret, parts[0]));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const { aid, eid, cid, st, exp } = p as Record<string, unknown>;
  if (typeof aid !== "string" || !UUID.test(aid)) return null;
  if (typeof eid !== "string" || !UUID.test(eid)) return null;
  if (cid !== undefined && (typeof cid !== "string" || !UUID.test(cid))) return null;
  // Phase 2 cookies have no st: they fail closed here and the visitor re-opens the link.
  if (typeof st !== "number" || !Number.isInteger(st) || st * 1000 > nowMs + CLOCK_SKEW_SEC * 1000) return null;
  if (typeof exp !== "number" || !Number.isInteger(exp) || exp * 1000 <= nowMs) return null;
  if (exp > st + SESSION_MAX_SEC) return null;
  return cid === undefined ? { aid, eid, st, exp } : { aid, eid, cid, st, exp };
}

export function sessionExpiry(accessExpiresAt: string | Date, startSec: number, nowMs: number = Date.now()): number {
  const link = Math.floor(new Date(accessExpiresAt).getTime() / 1000);
  return Math.min(link, Math.floor(nowMs / 1000) + SESSION_IDLE_SEC, startSec + SESSION_MAX_SEC);
}

export function setCookieHeader(value: string, maxAgeSec: number): string {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
