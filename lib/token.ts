import { createHash } from "node:crypto";

export function isTokenShape(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
