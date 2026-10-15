import { handlePreviewOpen } from "@/lib/preview-handlers";
import { depsFromEnv } from "@/lib/handlers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePreviewOpen(token, depsFromEnv());
}
