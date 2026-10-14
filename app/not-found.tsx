import type { CSSProperties } from "react";

const main: CSSProperties = {
  maxWidth: 560, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", lineHeight: 1.6, color: "#1f2933",
};
const button: CSSProperties = {
  display: "inline-block", marginTop: "1rem", padding: "0.75rem 1.5rem", borderRadius: 8,
  background: "#1f2933", color: "#ffffff", textDecoration: "none", fontWeight: 600,
};

export default function NotFound() {
  return (
    <main style={main}>
      <h1 style={{ lineHeight: 1.25 }}>We couldn&apos;t find that page</h1>
      <p>
        The link may be incomplete or may have expired. If you were invited to a Rosably project
        room, please open the link from your email again, or head back to our home page.
      </p>
      <a href="https://rosably.com" rel="noopener" style={button}>Go to the Rosably home page</a>
    </main>
  );
}
