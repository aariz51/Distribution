import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct } from "@/lib/products";
import { listAssets } from "@/lib/library";
import { getOrCreateConnection, listChannels, listSchedule } from "@/lib/publishing";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AutoFillCard, ChannelsCard, ScheduleForm, ScheduleList } from "@/components/publish";

export const dynamic = "force-dynamic";

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();

  const connection = await getOrCreateConnection(session.accountId);
  const channels = connection ? await listChannels(session.accountId) : [];
  const schedule = await listSchedule(id, session.accountId);
  const approved = await listAssets(id, { status: "approved" });

  const schedulable = approved.map((a) => ({
    id: a.id,
    type: a.type,
    durationSec: a.durationSec,
    thumbnailUrl: a.thumbnailUrl,
    hook: (a.candidate?.hook ?? (a.metadata as { hook?: string }).hook) ?? null,
    copyPlatforms: [...new Set(a.copy.map((c) => c.platform))],
  }));

  const cadence = (product.publishing.cadence ?? []).length > 0;

  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <PageHeader
        title="Publish"
        description="Schedule approved assets through Postiz and watch each channel report back."
      />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <ScheduleList items={schedule} />
          <ScheduleForm assets={schedulable} channels={channels} timezone={product.publishing.timezone} />
        </div>
        <div className="space-y-6">
          <ChannelsCard channels={channels} hasConnection={connection !== null} />
          <AutoFillCard productId={id} hasCadence={cadence} />
        </div>
      </div>
    </AppShell>
  );
}
