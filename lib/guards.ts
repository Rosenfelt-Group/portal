export function isSameOriginJson(req: Request, origin: string): boolean {
  if (req.headers.get("origin") !== origin) return false;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  return ct === "application/json" || ct.startsWith("application/json;");
}
