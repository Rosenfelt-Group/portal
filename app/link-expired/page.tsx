import { main, button } from "@/components/room-styles";

export const metadata = { title: "Rosably", robots: { index: false, follow: false } };

export default function LinkExpired() {
  return (
    <main style={main}>
      <h1 style={{ lineHeight: 1.25 }}>This link isn&apos;t working</h1>
      <p>
        It may have expired or been replaced — or your session ended after a period of inactivity. If
        you were here earlier, open your original room link again. Otherwise, ask your Rosably contact
        for a new link.
      </p>
      <a href="https://rosably.com" rel="noopener" style={button}>Go to the Rosably home page</a>
    </main>
  );
}
