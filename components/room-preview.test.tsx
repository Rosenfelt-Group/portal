import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// No DOM in this suite: hooks are stubbed so components can be called directly,
// effects are captured and run by hand, and click handlers are found in the element tree.
const effects: Array<() => unknown> = [];
let seeds: unknown[] = [];
let seedIdx = 0;
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const api = {
    ...actual,
    useState: (i: unknown) => {
      const seeded = seedIdx < seeds.length && seeds[seedIdx] !== undefined;
      const val = seeded ? seeds[seedIdx] : typeof i === "function" ? (i as () => unknown)() : i;
      seedIdx++;
      return [val, () => {}];
    },
    useRef: (i: unknown) => ({ current: i }),
    useCallback: (f: unknown) => f,
    useEffect: (f: () => unknown) => { effects.push(f); },
  };
  return { ...api, default: api };
});

import { renderToStaticMarkup } from "react-dom/server";
import { RoomView, SolutionCard, DocumentCard, DeliverableList, SessionEnded, versionLabel, type Version } from "@/components/RoomView";

const v = (over: object = {}) => ({ id: "v1", version_no: 2, status: "draft", shared_at: null, created_at: "2026-10-14T12:00:00Z", change_summary: null, screens: [], document: null, ...over }) as Version;
const proto = (over: object = {}) => ({ id: "p", title: "Proto", description: null, kind: "prototype" as const, welcome_message: null, versions: [v()], ...over });
const doc = (over: object = {}) => ({ id: "d", title: "Doc", description: null, kind: "document" as const, welcome_message: null, versions: [v({ id: "dv", document: { filename: "a.pdf", ext: "pdf", size: 10 } })], ...over });
const noop = () => {};

function findButton(node: unknown): { props: { onClick: () => void } } | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
  if (n.type === "button" && n.props?.onClick) return n as never;
  const kids = n.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) { const f = findButton(k); if (f) return f; }
  return null;
}

type El = { type?: unknown; props?: Record<string, unknown> };
function findAll(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) { node.forEach(k => findAll(k, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  const e = node as El;
  if (pred(e)) out.push(e);
  findAll(e.props?.children, pred, out);
  return out;
}
// RoomView state order: items, error, expired.
function room(mode: "visitor" | "preview" | undefined, state: { items?: unknown; expired?: boolean }) {
  seeds = [state.items, undefined, state.expired]; seedIdx = 0;
  const props = { title: "T", orgName: "O", relationship: "prospect", contactName: "" };
  const tree = RoomView(mode ? { ...props, mode } : props);
  seeds = [];
  return tree;
}

let fetchMock: ReturnType<typeof vi.fn>;
afterEach(() => { vi.unstubAllGlobals(); seeds = []; });
beforeEach(() => {
  effects.length = 0;
  seeds = []; seedIdx = 0;
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ deliverables: [], url: "https://x.example/d" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
const runEffects = async () => { for (const e of effects.splice(0)) await e(); };
const urls = () => fetchMock.mock.calls.map(c => String(c[0]));

describe("preview mode RoomView", () => {
  const props = { title: "Intake", orgName: "Org", relationship: "prospect", contactName: "" };
  it("shows the banner, no greeting, and fetches only /api/preview", async () => {
    const html = renderToStaticMarkup(<RoomView {...props} mode="preview" />);
    expect(html).toContain("Preview — this is what visitors will see once drafts are shared");
    expect(html).not.toContain("Hello,");
    await runEffects();
    expect(urls()).toEqual(["/api/preview/deliverables"]);
  });
  it("visitor mode keeps /api/room and has no banner", async () => {
    const html = renderToStaticMarkup(<RoomView {...props} contactName="Sam" />);
    expect(html).not.toContain("Preview — this is what visitors");
    expect(html).toContain("Hello, Sam");
    await runEffects();
    expect(urls()).toEqual(["/api/room/deliverables"]);
  });
});

describe("preview mode cards", () => {
  it("a prototype card fetches the preview-url under /api/preview", async () => {
    SolutionCard({ d: proto(), onSessionEnded: noop, api: "/api/preview" });
    await runEffects();
    expect(urls()).toEqual(["/api/preview/versions/v1/preview-url"]);
  });
  it("a document card POSTs document-url under /api/preview", async () => {
    vi.stubGlobal("window", { location: { assign: vi.fn() } });
    const el = DocumentCard({ d: doc(), onSessionEnded: noop, api: "/api/preview" });
    findButton(el)!.props.onClick();
    await new Promise(r => setTimeout(r, 0));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/preview/versions/dv/document-url");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });
  it("cards default to /api/room", async () => {
    SolutionCard({ d: proto(), onSessionEnded: noop });
    await runEffects();
    expect(urls()).toEqual(["/api/room/versions/v1/preview-url"]);
  });
});

describe("draft labels and preview copy", () => {
  it("marks drafts and leaves other statuses unchanged", () => {
    expect(versionLabel(v(), "UTC")).toBe("v2 · Oct 14, 2026 (draft)");
    expect(versionLabel(v({ status: "shared" }), "UTC")).toBe("v2 · Oct 14, 2026");
    expect(versionLabel(v({ status: "superseded" }), "UTC")).toBe("v2 · Oct 14, 2026 (older)");
  });
  it("uses the preview empty message and tolerates a deliverable with no versions", () => {
    expect(renderToStaticMarkup(<DeliverableList items={[]} onSessionEnded={noop} preview />)).toContain("No deliverables have been added yet.");
    const html = renderToStaticMarkup(<DeliverableList items={[proto({ versions: [] })]} onSessionEnded={noop} preview />);
    expect(html).toContain("No deliverables have been added yet.");
    expect(renderToStaticMarkup(<DeliverableList items={[]} onSessionEnded={noop} />)).toContain("Nothing has been shared yet");
  });
  it("words the ended session by mode", () => {
    expect(renderToStaticMarkup(<SessionEnded mode="preview" />)).toContain("Your preview ended. Use “Preview room” in the dashboard to open it again.");
    expect(renderToStaticMarkup(<SessionEnded mode="visitor" />)).toContain("Your session ended after 2 hours");
  });
});

describe("prop wiring", () => {
  const cards = (tree: unknown) => findAll(tree, e => e.type === SolutionCard || e.type === DocumentCard);
  it("DeliverableList passes api to both card kinds", () => {
    for (const api of [undefined, "/api/preview"]) {
      const found = cards(DeliverableList({ items: [proto(), doc()], onSessionEnded: noop, ...(api ? { api } : {}) }));
      expect(found.map(e => e.type)).toEqual([SolutionCard, DocumentCard]);
      for (const e of found) expect(e.props!.api).toBe(api ?? "/api/room");
    }
  });
  it("RoomView passes api and preview to DeliverableList in both modes", () => {
    const items = [proto(), doc()];
    for (const [mode, api, preview] of [["preview", "/api/preview", true], ["visitor", "/api/room", false], [undefined, "/api/room", false]] as const) {
      const [list] = findAll(room(mode, { items }), e => e.type === DeliverableList);
      expect(list.props!.api).toBe(api);
      expect(list.props!.preview).toBe(preview);
      expect(list.props!.items).toBe(items);
    }
  });
  it("RoomView renders SessionEnded with its mode when the session expired", () => {
    for (const [mode, text] of [["preview", "Your preview ended."], ["visitor", "Your session ended after 2 hours"]] as const) {
      const tree = room(mode, { expired: true });
      const [ended] = findAll(tree, e => e.type === SessionEnded);
      expect(ended.props!.mode).toBe(mode);
      expect(renderToStaticMarkup(<SessionEnded mode={ended.props!.mode as "visitor" | "preview"} />)).toContain(text);
    }
    expect(findAll(room("preview", {}), e => e.type === SessionEnded)).toHaveLength(0);
  });
});
