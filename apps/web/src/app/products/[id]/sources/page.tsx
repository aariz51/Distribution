import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct } from "@/lib/products";
import { listSources } from "@/lib/library";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AddSource } from "@/components/AddSource";
import { SourceRow } from "@/components/SourceRow";
import { Card, CardHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  const sources = await listSources(id);

  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <PageHeader title="Sources" description="Long-form videos that get cut into shorts. Rights are checked before anything is downloaded." />
      <AddSource productId={id} />

      <Card className="mt-6">
        <CardHeader title="All sources" meta={sources.length} />
        {sources.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">No sources yet. Add a YouTube URL or upload a video above.</p>
        ) : (
          <>
            <div className="hidden border-y border-hairline bg-canvas px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-faint lg:grid lg:grid-cols-[minmax(0,1fr)_110px_120px_90px_140px_auto]">
              <span>Source</span>
              <span>Duration</span>
              <span>Rights</span>
              <span>Status</span>
              <span>Clips · run</span>
              <span className="text-right">Action</span>
            </div>
            <ul className="divide-y divide-hairline">
              {sources.map((s) => (
                <SourceRow key={s.id} productId={id} source={s} />
              ))}
            </ul>
          </>
        )}
      </Card>
    </AppShell>
  );
}
