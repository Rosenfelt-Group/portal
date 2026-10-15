import { describe, it, expect, vi, beforeEach } from "vitest";

// No DOM in this suite: hooks are stubbed so components can be called directly,
// effects are captured and run by hand, and click handlers are found in the element tree.
const effects: Array<() => unknown> = [];
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const api = {
    ...actual,
    useState: (i: unknown) => [typeof i === "function" ? (i as () => unknown)() : i, () => {}],
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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  effects.length = 0;
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
