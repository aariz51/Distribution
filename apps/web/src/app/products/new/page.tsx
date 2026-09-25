import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { IntakeWizard } from "@/components/IntakeWizard";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const welcome = (await searchParams).welcome === "1";
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <AppShell email={session.email}>
      {welcome && (
        <p role="status" className="mb-6 rounded-[10px] border border-hairline bg-accent-soft px-4 py-3 text-sm">
          Your workspace is ready. Start by describing your product: its name, what it does, a logo and a few screenshots. Promos and clips both read from this.
        </p>
      )}
      <PageHeader title="Describe your product once" description="Everything downstream — films, clips, thumbnails, copy — reads from this profile." />
      <IntakeWizard />
    </AppShell>
  );
}
