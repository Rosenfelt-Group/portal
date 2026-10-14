"use client";
import { useRef, useState, type FormEvent } from "react";
import { main, button, input, label } from "./room-styles";

export function IntroForm({ orgName }: { orgName: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/room/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (res.ok) {
        // Not useRouter: this component must render outside the Next router (unit tests).
        window.location.reload();
        return;
      }
      let msg = "Something went wrong. Please try again.";
      try {
        const data = await res.json();
        if (data && typeof data.error === "string" && data.error) msg = data.error;
      } catch { /* keep default */ }
      setError(msg);
    } catch {
      setError("Something went wrong. Please try again.");
    }
    inFlight.current = false;
    setPending(false);
  }

  return (
    <main style={main}>
      <h1 style={{ lineHeight: 1.25 }}>Welcome</h1>
      <p>{orgName}</p>
      <p>Before we begin, please tell us who is looking so we can follow up on your feedback.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="room-name" style={label}>Your name</label>
        <input id="room-name" name="name" type="text" required maxLength={100} autoComplete="name"
          value={name} onChange={e => setName(e.target.value)} style={input} />
        <label htmlFor="room-email" style={label}>Your email</label>
        <input id="room-email" name="email" type="email" required autoComplete="email"
          value={email} onChange={e => setEmail(e.target.value)} style={input} />
        {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
        <button type="submit" disabled={pending} style={button}>{pending ? "Please wait…" : "Continue"}</button>
      </form>
    </main>
  );
}
