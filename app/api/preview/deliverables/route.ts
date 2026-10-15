import { cookies } from "next/headers";
import { handlePreviewDeliverables } from "@/lib/preview-handlers";
import { depsFromEnv } from "@/lib/handlers";
import { PREVIEW_COOKIE } from "@/lib/preview";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  return handlePreviewDeliverables(jar.get(PREVIEW_COOKIE)?.value, depsFromEnv());
}
