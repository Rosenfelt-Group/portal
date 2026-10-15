import { describe, it, expect } from "vitest";
import { formatVersionDate, formatBytes } from "./format";

describe("formatVersionDate", () => {
  it("formats as 'Oct 14, 2026' in the given zone", () => {
    expect(formatVersionDate("2026-10-14T12:00:00Z", "UTC")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "America/Los_Angeles")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "UTC")).toBe("Oct 15, 2026");
  });
  it("accepts a Date", () => {
    expect(formatVersionDate(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("Jan 5, 2026");
  });
  it("is empty for an invalid date, an invalid Date, or an unknown zone", () => {
    expect(formatVersionDate("x")).toBe("");
    expect(formatVersionDate(new Date("nope"))).toBe("");
    expect(formatVersionDate("2026-10-14T12:00:00Z", "Not/AZone")).toBe("");
  });
});

describe("formatBytes", () => {
  it("uses B, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1572864)).toBe("1.5 MB");
  });
});
