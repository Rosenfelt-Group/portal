import { cookies } from "next/headers";
import { handleIdentify, depsFromEnv } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  return handleIdentify(req, jar.get(COOKIE_NAME)?.value, depsFromEnv());
}
