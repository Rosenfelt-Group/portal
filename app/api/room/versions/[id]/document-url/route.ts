import { cookies } from "next/headers";
import { handleDocumentUrl, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  return handleDocumentUrl(req, jar.get(COOKIE_NAME)?.value, id, depsFromEnv());
}
