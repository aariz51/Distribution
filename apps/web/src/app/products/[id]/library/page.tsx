import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct } from "@/lib/products";
import { libraryCounts, listAssets } from "@/lib/library";
import type { AssetItem as AssetView } from "@/components/views";
import { AppShell, PageHeader } from "@/components/AppShell";
import { AssetActions } from "@/components/AssetActions";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { FilterPills } from "@/components/ui/Tabs";
import { formatDuration, formatRelative, isLandscapeType, typeLabel } from "@/components/ui/format";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ label: string; value: string | null }> = [
  { label: "All", value: null },
  { label: "Review", value: "review" },
  { label: "Approved", value: "approved" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Published", value: "published" },
  { label: "Failed", value: "failed" },
  { label: "Archived", value: "archived" },
];

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const { status } = await searchParams;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  const [assets, counts] = await Promise.all([listAssets(id, { status: status || undefined }), libraryCounts(id)]);
  const platforms = product.publishing.channelIds;

  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <PageHeader title="Library" description="Every clip, promo cut, thumbnail and its platform copy. Approve here; scheduling follows." />
      <FilterPills param="status" options={FILTERS.map((f) => ({ ...f, count: f.value ? counts.byStatus[f.value] ?? 0 : counts.total }))} className="mb-6" />

      {assets.length === 0 ? (
        <EmptyState
          title={status ? `No ${status} assets.` : "No assets yet — add a source to generate clips."}
          action={status ? <ButtonLink href={`/products/${id}/library`}>Show all</ButtonLink> : <ButtonLink href={`/products/${id}/sources`} variant="primary">Add a source</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <li key={a.id}>
              <AssetCard asset={a} platforms={platforms} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function AssetCard({ asset: a, platforms }: { asset: AssetView; platforms: string[] }) {
  const VIDEO_TYPES = new Set(["clip", "clip_enriched", "promo_vertical", "promo_landscape", "promo_store_portrait", "promo_store_landscape"]);
  const isVideo = a.mimeType ? a.mimeType.startsWith("video/") : VIDEO_TYPES.has(a.type);
  const isImage = a.mimeType ? a.mimeType.startsWith("image/") : a.type === "thumbnail" || a.type === "creative_image";
  const landscape = isLandscapeType(a.type) || (a.width != null && a.height != null && a.width > a.height);
  const frame = landscape ? "aspect-video" : "aspect-[9/16] max-h-[420px]";
  return (
    <article className="surface flex h-full flex-col overflow-hidden">
      <div className={`relative bg-[#0d1114] ${landscape ? "aspect-video" : "flex justify-center"}`}>
        {isVideo ? (
          <video src={a.url} poster={a.thumbnailUrl ?? undefined} muted controls preload="metadata" playsInline className={`${landscape ? "h-full w-full" : "aspect-[9/16] h-auto max-h-[420px] w-auto"} object-contain`} />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.url} alt="" className={`${landscape ? "h-full w-full" : "max-h-[420px] w-auto"} object-contain`} loading="lazy" />
        ) : (
          <div className={`grid ${frame} w-full place-items-center text-xs text-white/60`}>
            <a href={a.url} className="underline decoration-white/30 underline-offset-2" target="_blank" rel="noreferrer">Open file</a>
          </div>
        )}
        {a.durationSec != null && <span className="absolute bottom-2 right-2 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white">{formatDuration(a.durationSec)}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted">{typeLabel(a.type)}</p>
            {a.candidate?.hook ? <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{a.candidate.hook}</p> : <p className="mt-0.5 font-mono text-[12px] text-faint">{a.id.slice(0, 8)}</p>}
          </div>
          <Pill status={a.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted tabular-nums">
          {a.candidate && (
            <span title="Candidate score">
              Score <span className="font-medium text-ink">{Math.round(a.candidate.score * (a.candidate.score <= 1 ? 100 : 1))}%</span>
            </span>
          )}
          {a.candidate && <span className="font-mono text-faint">{formatDuration(a.candidate.startSec)}–{formatDuration(a.candidate.endSec)}</span>}
          <span className="text-faint" title={new Date(a.createdAt).toLocaleString()}>{formatRelative(a.createdAt)}</span>
          <Pill status={a.approvalState} dot={false} className="h-5 px-1.5 text-[11px]">
            {a.approvalState}
          </Pill>
        </div>
        {a.failureReason && <p className="text-xs text-red-600">{a.failureReason}</p>}
        {a.scheduledFor && <p className="text-xs text-muted">Scheduled {new Date(a.scheduledFor).toLocaleString()}</p>}
        <div className="mt-auto border-t border-hairline pt-3">
          <AssetActions asset={a} platforms={platforms} />
        </div>
      </div>
    </article>
  );
}
