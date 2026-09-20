import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { IntakeWizard } from "@/components/IntakeWizard";

export default async function NewProductPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <AppShell email={session.email}>
      <PageHeader title="Describe your product once" description="Everything downstream — films, clips, thumbnails, copy — reads from this profile." />
      <IntakeWizard />
    </AppShell>
  );
}
