import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { depsFromEnv, requireSession } from "@/lib/handlers";
import { COOKIE_NAME } from "@/lib/session";
import { IntroForm } from "@/components/IntroForm";
import { RoomView } from "@/components/RoomView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rosably", robots: { index: false, follow: false } };

export default async function RoomPage() {
  const jar = await cookies();
  const sess = await requireSession(jar.get(COOKIE_NAME)?.value, depsFromEnv());
  if (!sess) redirect("/link-expired");
  if (!sess.row.contact_id) return <IntroForm orgName={sess.row.org_name} />;
  return (
    <RoomView title={sess.row.title} orgName={sess.row.org_name} relationship={sess.row.relationship}
      contactName={sess.row.contact_name ?? ""} />
  );
}
