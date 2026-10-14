import postgres from "postgres";

export type Q = <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

let client: ReturnType<typeof postgres> | undefined;

// Lazy, pooled-connection client for the limited portal_app role. Never log the URL or any query values.
export function getQ(): Q {
  if (!client) {
    const url = process.env.PORTAL_DATABASE_URL;
    if (!url) throw new Error("PORTAL_DATABASE_URL is not configured");
    client = postgres(url, { max: 1, prepare: false, ssl: "require", idle_timeout: 20, connect_timeout: 10 });
  }
  const c = client;
  return ((strings: TemplateStringsArray, ...values: unknown[]) =>
    c(strings, ...(values as never[])) as unknown as Promise<unknown[]>) as unknown as Q;
}
