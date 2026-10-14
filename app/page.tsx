import type { CSSProperties } from "react";

const main: CSSProperties = {
  maxWidth: 560, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", lineHeight: 1.6, color: "#1f2933",
};
const button: CSSProperties = {
  display: "inline-block", marginTop: "1rem", padding: "0.75rem 1.5rem", borderRadius: 8,
  background: "#1f2933", color: "#ffffff", textDecoration: "none", fontWeight: 600,
};

export default function Home() {
  return (
    <main style={main}>
      <h1 style={{ lineHeight: 1.25 }}>Welcome to the Rosably portal</h1>
      <p>
        This is a private space for people working with Rosably. If you were invited, please use the
        link in your email to get in. Otherwise, you can head back to our home page.
      </p>
      <a href="https://rosably.com" rel="noopener" style={button}>Go to the Rosably home page</a>
    </main>
  );
}
