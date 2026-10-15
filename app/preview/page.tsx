import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { depsFromEnv } from "@/lib/handlers";
import { requirePreview } from "@/lib/preview-handlers";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { RoomView } from "@/components/RoomView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rosably preview", robots: { index: false, follow: false } };

export default async function PreviewPage() {
  const jar = await cookies();
  const sess = await requirePreview(jar.get(PREVIEW_COOKIE)?.value, depsFromEnv());
  if (!sess) redirect("/link-expired");
  return (
    <RoomView mode="preview" title={sess.row.title} orgName={sess.row.org_name}
      relationship={sess.row.relationship} contactName="" />
  );
}
