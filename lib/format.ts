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

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
