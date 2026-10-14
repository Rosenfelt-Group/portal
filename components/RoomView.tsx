"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { main, button, card } from "./room-styles";

interface Version {
  id: string; version_no: number; status: string; shared_at: string | null;
  change_summary: string | null; screens: { id: string; name: string }[];
}
interface Deliverable { id: string; title: string; description: string | null; versions: Version[] }

const REFRESH_MS = 10 * 60 * 1000;

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

function SolutionCard({ d }: { d: Deliverable }) {
  const versions = [...d.versions].sort((a, b) => b.version_no - a.version_no);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = versions.find(v => v.id === versionId);

  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    setUrl(null);
    setErr(null);
    async function load(silent: boolean) {
      try {
        const res = await fetch(`/api/room/versions/${encodeURIComponent(versionId)}/preview-url`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && typeof data.url === "string") setUrl(data.url);
      } catch {
        if (!cancelled && !silent) setErr("This preview isn't available right now.");
      }
    }
    void load(false);
    const timer = setInterval(() => { void load(true); }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [versionId]);

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0 }}>{d.title}</h2>
      {d.description && <p>{d.description}</p>}
      <label htmlFor={`ver-${d.id}`} style={{ fontWeight: 600 }}>Version </label>
      <select id={`ver-${d.id}`} value={versionId} onChange={e => setVersionId(e.target.value)}>
        {versions.map(v => (
          <option key={v.id} value={v.id}>{`v${v.version_no}${v.status === "superseded" ? " (older)" : ""}`}</option>
        ))}
      </select>
      {current?.change_summary && <p>{current.change_summary}</p>}
      <FrameLabel />
      {err && <p role="alert" style={{ color: "#b42318" }}>{err}</p>}
      {url && (
        // SECURITY: never add allow-same-origin (or top-navigation, popups, modals, downloads) here.
        <iframe src={url} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"
          title="Prototype preview"
          style={{ width: "100%", height: "70vh", border: "1px solid #d0d5dd", borderRadius: 8 }} />
      )}
    </section>
  );
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

  return (
    <main style={{ ...main, maxWidth: 960, textAlign: "left" }}>
      <p style={{ margin: 0, color: "#475467" }}>{orgName}</p>
      <h1 style={{ lineHeight: 1.25, marginTop: 0 }}>{title}</h1>
      {contactName && <p>Hello, {contactName}</p>}
      <p>{welcomeText(relationship)}</p>
      {expired && (
        <p role="alert">
          Your session has ended. <a href="/room">Reload this page</a> to continue.
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <button type="button" style={{ ...button, marginTop: 0 }} onClick={() => { void load(); }}>Retry</button>
        </p>
      )}
      {items && items.length === 0 && (
        <p>Nothing has been shared yet. We&apos;ll let you know when there&apos;s something to review.</p>
      )}
      {items?.map(d => <SolutionCard key={d.id} d={d} />)}
    </main>
  );
}
