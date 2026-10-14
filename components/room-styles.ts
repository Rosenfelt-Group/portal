import type { CSSProperties } from "react";

export const main: CSSProperties = {
  maxWidth: 560, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", lineHeight: 1.6, color: "#1f2933",
};
export const button: CSSProperties = {
  display: "inline-block", marginTop: "1rem", padding: "0.75rem 1.5rem", borderRadius: 8,
  background: "#1f2933", color: "#ffffff", textDecoration: "none", fontWeight: 600,
  border: "none", cursor: "pointer", fontSize: "1rem",
};
export const card: CSSProperties = {
  border: "1px solid #d0d5dd", borderRadius: 12, padding: "1.25rem", margin: "1.25rem 0",
  textAlign: "left", background: "#ffffff",
};
export const input: CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box", marginTop: "0.25rem",
  padding: "0.65rem 0.75rem", border: "1px solid #98a2b3", borderRadius: 8, fontSize: "1rem",
};
export const label: CSSProperties = {
  display: "block", textAlign: "left", marginTop: "1rem", fontWeight: 600,
};
