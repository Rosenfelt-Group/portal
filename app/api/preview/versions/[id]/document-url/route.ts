import { cookies } from "next/headers";
import { handlePreviewDocumentUrl } from "@/lib/preview-handlers";
import { depsFromEnv } from "@/lib/handlers";
import { PREVIEW_COOKIE } from "@/lib/preview";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jar = await cookies();
  return handlePreviewDocumentUrl(req, jar.get(PREVIEW_COOKIE)?.value, id, depsFromEnv());
}
