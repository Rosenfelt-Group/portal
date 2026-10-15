"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { main, button, card } from "./room-styles";
import { formatVersionDate, formatBytes } from "@/lib/format";

export interface Version {
  id: string; version_no: number; status: string; shared_at: string | null; created_at: string | null;
  change_summary: string | null; screens: { id: string; name: string }[];
  document: { filename: string; ext: string; size: number } | null;
}
interface Deliverable { id: string; title: string; description: string | null; kind: "prototype" | "document"; welcome_message: string | null; versions: Version[] }

export function versionLabel(v: Version, timeZone?: string): string {
  const date = v.created_at ? formatVersionDate(v.created_at, timeZone) : "";
  return `v${v.version_no}${date ? ` · ${date}` : ""}${v.status === "superseded" ? " (older)" : ""}`;
}

// Plain text only: React escapes it; pre-line keeps the line breaks Brian typed.
// Whitespace-only text counts as absent; overflowWrap keeps a long unbroken string inside the card.
export function WelcomeNote({ text }: { text: string }) {
  if (typeof text !== "string" || text.trim() === "") return null;
  return <p style={{ whiteSpace: "pre-line", overflowWrap: "anywhere", margin: "0.25rem 0 0.75rem" }}>{text}</p>;
}

export function welcomeText(relationship: string): string {
  switch (relationship) {
    case "prospect": return "Here are the prototypes we've prepared for you. Click through them and tell us what you think.";
    case "client": return "Here's the latest on your project. Click through what we've shared.";
    case "partner": return "Here's what we've shared to collaborate on. Click through it any time.";
    default: return "Here's what we've shared with you.";
  }
}

export function FrameLabel() {
  return (
    <p style={{ fontSize: "0.85rem", color: "#475467", margin: "0.5rem 0" }}>
      Prototype preview — untrusted content. Don&apos;t enter real passwords or personal data.
    </p>
  );
}

export function sortVersions(versions: Version[]): Version[] {
  return [...versions].sort((a, b) => b.version_no - a.version_no);
}

// Sized to the viewport: a sandboxed cross-origin frame cannot be measured, so a prototype taller than the window still scrolls inside the frame.
export function PreviewFrame({ url }: { url: string }) {
  return (
    // SECURITY: never add allow-same-origin (or top-navigation, popups, modals, downloads) here.
    <iframe src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"
      title="Prototype preview"
      style={{ width: "100%", height: "calc(100dvh - 2rem)", minHeight: 480, border: "1px solid #d0d5dd", borderRadius: 8 }} />
  );
}

// Why there is no background refresh of the preview URL: the grant is part of the path
// (/v/<grant>/<entry>) and the preview host checks it on every request, so relative assets load
// under the same grant. Swapping the src would reload the prototype and lose the visitor's place,
// so the src stays fixed while the page is open and changes only when the visitor picks another
// version or presses "Reload preview". Cross-origin iframes give no reliable failure signal, so
// that button is always shown; it fetches a fresh grant (needed after ~15 minutes if lazily
// loaded assets or an in-frame reload start failing).
function SolutionCard({ d, onSessionEnded }: { d: Deliverable; onSessionEnded: () => void }) {
  const versions = sortVersions(d.versions);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const current = versions.find(v => v.id === versionId);

  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    setUrl(null);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/room/versions/${encodeURIComponent(versionId)}/preview-url`);
        if (res.status === 401) { if (!cancelled) onSessionEnded(); return; }
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && typeof data.url === "string") setUrl(data.url);
      } catch {
        if (!cancelled) setErr("This preview isn't available right now.");
      }
    })();
    return () => { cancelled = true; };
  }, [versionId, nonce, onSessionEnded]);

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{d.title}</h2>
      {d.description && <p>{d.description}</p>}
      {d.welcome_message?.trim() && <WelcomeNote text={d.welcome_message} />}
      <label htmlFor={`ver-${d.id}`} style={{ fontWeight: 600 }}>Version </label>
      <select id={`ver-${d.id}`} value={versionId} onChange={e => setVersionId(e.target.value)}>
        {versions.map(v => (
          <option key={v.id} value={v.id}>{versionLabel(v)}</option>
        ))}
      </select>
      {current?.change_summary && <p>{current.change_summary}</p>}
      <FrameLabel />
      {err && <p role="alert" style={{ color: "#b42318" }}>{err}</p>}
      {url && <PreviewFrame url={url} />}
      <button type="button" style={{ ...button, marginTop: "0.75rem", padding: "0.4rem 1rem", fontSize: "0.9rem" }}
        onClick={() => setNonce(n => n + 1)}>Reload preview</button>
    </section>
  );
}

// Documents are only ever downloaded (attachment from the preview host), never shown in this page.
// The signed URL is fetched on click (it lives 2 minutes), used once for navigation and never logged or stored.
export function DocumentCard({ d, onSessionEnded }: { d: Deliverable; onSessionEnded: () => void }) {
  const versions = sortVersions(d.versions);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const current = versions.find(v => v.id === versionId);
  const size = current?.document ? formatBytes(current.document.size) : "";

  const download = async () => {
    if (!versionId || inFlight.current) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/room/versions/${encodeURIComponent(versionId)}/document-url`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (res.status === 401) { onSessionEnded(); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (typeof data.url !== "string" || !data.url.startsWith("https://")) throw new Error("bad url");
      window.location.assign(data.url);
    } catch {
      setErr("This file isn't available right now.");
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{d.title}</h2>
      {d.description && <p>{d.description}</p>}
      {d.welcome_message?.trim() && <WelcomeNote text={d.welcome_message} />}
      <label htmlFor={`ver-${d.id}`} style={{ fontWeight: 600 }}>Version </label>
      <select id={`ver-${d.id}`} value={versionId} onChange={e => setVersionId(e.target.value)}>
        {versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
      </select>
      {current?.change_summary && <p>{current.change_summary}</p>}
      {current?.document && (
        <p style={{ margin: "0.75rem 0 0", overflowWrap: "anywhere" }}>
          {current.document.filename} · {current.document.ext.toUpperCase()}{size && ` · ${size}`}
        </p>
      )}
      {err && <p role="alert" style={{ color: "#b42318" }}>{err}</p>}
      <button type="button" disabled={busy} style={{ ...button, padding: "0.5rem 1.25rem", fontSize: "0.95rem" }} onClick={() => { void download(); }}>Download</button>
      <p style={{ fontSize: "0.85rem", color: "#475467" }}>The file downloads to your device; it is never opened inside this page.</p>
    </section>
  );
}

// Everything visible in the room: prototypes and documents. The empty message shows only when nothing is.
export function DeliverableList({ items, onSessionEnded }: { items: Deliverable[]; onSessionEnded: () => void }) {
  const visible = items.filter(d => Array.isArray(d.versions) && d.versions.length > 0);
  if (visible.length === 0) {
    return <p>Nothing has been shared yet. We&apos;ll let you know when there&apos;s something to review.</p>;
  }
  return <>{visible.map(d => d.kind === "document"
    ? <DocumentCard key={d.id} d={d} onSessionEnded={onSessionEnded} />
    : <SolutionCard key={d.id} d={d} onSessionEnded={onSessionEnded} />)}</>;
}

export function RoomView({ title, orgName, relationship, contactName }: {
  title: string; orgName: string; relationship: string; contactName: string;
}) {
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const res = await fetch("/api/room/deliverables");
      if (res.status === 401) { setExpired(true); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setItems(Array.isArray(data.deliverables) ? data.deliverables : []);
    } catch {
      setError("We couldn't load this right now.");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onSessionEnded = useCallback(() => setExpired(true), []);

  return (
    <main style={{ ...main, maxWidth: 960, textAlign: "left" }}>
      <p style={{ margin: 0, color: "#475467" }}>{orgName}</p>
      <h1 style={{ lineHeight: 1.25, marginTop: 0 }}>{title}</h1>
      {contactName && <p>Hello, {contactName}</p>}
      <p>{welcomeText(relationship)}</p>
      {expired && (
        <p role="alert">
          Your session ended after 2 hours without activity (or 8 hours in total). Open your room link again to continue.
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <button type="button" style={{ ...button, marginTop: 0 }} onClick={() => { void load(); }}>Retry</button>
        </p>
      )}
      {items && <DeliverableList items={items} onSessionEnded={onSessionEnded} />}
    </main>
  );
}
