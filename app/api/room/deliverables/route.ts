import { cookies } from "next/headers";
import { handleDeliverables, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  return handleDeliverables(jar.get(COOKIE_NAME)?.value, depsFromEnv());
}
