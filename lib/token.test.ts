import { describe, it, expect } from "vitest";
import { isTokenShape, hashToken } from "./token";

describe("token", () => {
  it("accepts exactly 43 url-safe characters", () => {
    expect(isTokenShape("a".repeat(43))).toBe(true);
    expect(isTokenShape("A_-0".repeat(10) + "abc")).toBe(true);
  });
  it("rejects everything else before any lookup", () => {
    for (const bad of ["", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "!", "a".repeat(42) + "\n", " " + "a".repeat(42),
      "../".repeat(15), "a".repeat(42) + "/", null as unknown as string, 5 as unknown as string]) {
      expect(isTokenShape(bad)).toBe(false);
    }
  });
  it("hashes to 64 lowercase hex and matches the dashboard's SHA-256 digest", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
