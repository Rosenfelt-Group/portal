import { describe, it, expect } from "vitest";
import { openRoom, getSessionRow, identify, listDeliverables, versionForPreview, type Q } from "./queries";

const A = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const E = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const C = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
const V = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";

function fake(rows: unknown[][]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return rows.shift() ?? [];
  }) as unknown as Q;
  return { q, calls };
}

describe("queries call only the portal functions with typed params", () => {
  it("openRoom", async () => {
    const { q, calls } = fake([[{ access_id: A }]]);
    expect(await openRoom(q, "h".repeat(64))).toEqual({ access_id: A });
    expect(calls[0].text).toContain("rooms.portal_open_room(");
    expect(calls[0].values).toEqual(["h".repeat(64)]);
  });
  it("openRoom returns null when the function returns no row", async () => {
    expect(await openRoom(fake([[]]).q, "h".repeat(64))).toBeNull();
  });
  it("getSessionRow passes a null contact explicitly", async () => {
    const { q, calls } = fake([[{ access_id: A }]]);
    await getSessionRow(q, A, E, undefined);
    expect(calls[0].text).toContain("rooms.portal_session(");
    expect(calls[0].values).toEqual([A, E, null]);
  });
  it("identify returns the id or null", async () => {
    expect(await identify(fake([[{ portal_identify: C }]]).q, A, E, "Pat", "p@x.co")).toBe(C);
    expect(await identify(fake([[{ portal_identify: null }]]).q, A, E, "Pat", "bad")).toBeNull();
    expect(await identify(fake([[]]).q, A, E, "Pat", "p@x.co")).toBeNull();
  });
  it("listDeliverables and versionForPreview", async () => {
    const l = fake([[{ version_id: V }]]);
    expect(await listDeliverables(l.q, A, E)).toEqual([{ version_id: V }]);
    expect(l.calls[0].text).toContain("rooms.portal_list_deliverables(");
    const p = fake([[{ storage_prefix: "a/b/v1", entry: "index.html" }]]);
    expect(await versionForPreview(p.q, A, E, C, V)).toEqual({ storage_prefix: "a/b/v1", entry: "index.html" });
    expect(p.calls[0].values).toEqual([A, E, C, V]);
  });
  it("never uses string concatenation: all inputs arrive as bound values", async () => {
    const { q, calls } = fake([[]]);
    await identify(q, A, E, "x'); drop table rooms.engagements; --", "a@b.co");
    expect(calls[0].text).not.toContain("drop table");
    expect(calls[0].values).toContain("x'); drop table rooms.engagements; --");
  });
});
