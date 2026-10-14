export const metadata = { title: "Rosably Portal", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body style={{ fontFamily: "system-ui", margin: 0 }}>{children}</body></html>;
}
