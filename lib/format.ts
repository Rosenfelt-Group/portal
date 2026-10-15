// "Oct 14, 2026" in the viewer's time zone (or the zone given, for tests). "" if the date or zone is invalid.
export function formatVersionDate(value: string | Date, timeZone?: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return "";
  }
}

// "" for anything that is not a finite, non-negative number. Rounds into the next unit (1048575 -> "1.0 MB").
export function formatBytes(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  const b = Math.round(n);
  if (b < 1024) return `${b} B`;
  const kb = Math.round(b / 1024);
  if (kb < 1024) return `${kb} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
