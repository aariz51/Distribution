import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct, listBrandAssets } from "@/lib/products";
import { libraryCounts, listJobs, productProgress } from "@/lib/library";
import { getOrCreateConnection, listChannels } from "@/lib/publishing";
import { GettingStarted } from "@/components/GettingStarted";
import { AppShell } from "@/components/AppShell";
import { WorkerStatus } from "@/components/WorkerStatus";
import { PaletteCard } from "@/components/PaletteCard";
import { AssetUploader } from "@/components/AssetUploader";
import { GeneratePromo } from "@/components/GeneratePromo";
import { JobProgress } from "@/components/JobProgress";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { ButtonLink } from "@/components/ui/Button";
import { formatRelative, humanize } from "@/components/ui/format";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  const [brandAssets, counts, recentJobs, progress] = await Promise.all([listBrandAssets(id), libraryCounts(id), listJobs(id, 6), productProgress(id)]);
  const channelCount = (await getOrCreateConnection(session.accountId)) ? (await listChannels(session.accountId)).filter((c) => !c.disabled).length : 0;
  const logo = brandAssets.find((a) => a.id === product.brand.logoAssetId);
  const screens = product.brand.screenshotAssetIds.flatMap(assetId => brandAssets.filter(a => a.id === assetId));
  const prefs = product.contentPreferences;

  const prefRows: Array<[string, string]> = [
    ["Caption preset", prefs.captionPresetId],
    ["Voice", humanize(prefs.voice)],
    ["Source checks", "Music and female figures blocked"],
    ["B-roll people", prefs.peoplePolicy === "no-people" ? "No people" : "No female figures"],
    ["Clips per source", String(prefs.clipsPerSource)],
    ["Clip length", `${prefs.clipLengthSec.min}–${prefs.clipLengthSec.max}s`],
    ["Hashtags", humanize(prefs.hashtagStrategy)],
    ["Copy tone", prefs.copyTone],
    ["Timezone", product.publishing.timezone],
  ];

  return (
    <AppShell email={session.email} product={{ id, name: product.product.name }}>
      <WorkerStatus />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt="" className="h-14 w-14 shrink-0 rounded-[10px] border border-hairline bg-surface object-cover" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] border border-dashed border-hairline-strong text-lg font-semibold text-faint">{product.product.name.charAt(0)}</span>
          )}
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{product.product.name}</h1>
            <p className="mt-0.5 text-sm text-muted">{product.product.tagline}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              <span className="rounded-full border border-hairline bg-surface px-2 py-0.5 tabular-nums">v{product.version}</span>
              <span className="rounded-full border border-hairline bg-surface px-2 py-0.5">{product.product.category.primary}</span>
              {product.product.platforms.map((p) => (
                <span key={p} className="rounded-full border border-hairline bg-surface px-2 py-0.5">{p}</span>
              ))}
            </div>
          </div>
        </div>
        <div id="promo" className="flex flex-wrap items-start gap-3 scroll-mt-24">
          <ButtonLink href={`/products/${id}/edit`} variant="secondary">Edit product</ButtonLink>
          <GeneratePromo savedInspirationUrl={product.sources.promoReference?.kind === "url" ? product.sources.promoReference.url : undefined} productId={id} hasLogo={Boolean(logo)} screenCount={screens.length} />
          <ButtonLink href={`/products/${id}/sources`} variant="secondary">
            Generate shorts
          </ButtonLink>
        </div>
      </div>

      <GettingStarted productId={id} progress={progress} channels={channelCount} />

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="In review" value={counts.review} tone="amber" href={`/products/${id}/library?status=review`} hint="Awaiting your approval" />
        <StatTile label="Approved" value={counts.approved} tone="emerald" href={`/products/${id}/library?status=approved`} hint="Ready to schedule" />
        <StatTile label="Published" value={counts.published} tone="teal" href={`/products/${id}/library?status=published`} hint={counts.failed > 0 ? `${counts.failed} failed` : `${counts.total} assets total`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Features" meta={`${product.product.features.length} · priority order`} />
            <CardBody>
              <ol className="divide-y divide-hairline">
                {product.product.features.map((f, i) => (
                  <li key={f.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-6 shrink-0 pt-px font-mono text-[12px] tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.title}</p>
                      {f.detail && <p className="mt-0.5 text-[13px] text-muted">{f.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Audience" />
            <CardBody>
              <p className="text-sm leading-relaxed">{product.product.audience.summary}</p>
              {product.product.audience.painPoints.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {product.product.audience.painPoints.map((p) => (
                    <span key={p} className="rounded-full border border-hairline bg-canvas px-2 py-0.5 text-[12px] text-muted">{p}</span>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Screenshots" meta={screens.length} action={<AssetUploader productId={id} />} />
            <CardBody>
              {screens.length === 0 ? (
                <p className="text-sm text-muted">No screenshots yet. Add them to feed promo films and thumbnails.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {screens.map((s) => (
                    <li key={s.id} className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt="" className="aspect-[9/19] w-full object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <PaletteCard productId={id} palette={product.brand.palette} hasAssets={brandAssets.length > 0} />

          <Card>
            <CardHeader title="Content preferences" />
            <CardBody>
              <dl className="divide-y divide-hairline text-[13px]">
                {prefRows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
                    <dt className="text-muted">{k}</dt>
                    <dd className="truncate text-right font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  ["Brand colours", prefs.captionUseBrandColors],
                  ["Title banner", prefs.titleBanner],
                  ["B-roll", prefs.broll],
                  ["SFX", prefs.sfx],
                  ["End card", prefs.outro],
                  ["Clean source", prefs.cleanSource],
                ].map(([label, on]) => (
                  <span key={String(label)} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-[#c9e3db] bg-accent-soft text-accent" : "border-hairline text-faint line-through"}`}>
                    {String(label)}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent jobs"
              action={
                <Link href={`/products/${id}/jobs`} className="text-xs text-muted hover:text-ink">
                  View all
                </Link>
              }
            />
            <CardBody>
              {recentJobs.length === 0 ? (
                <p className="text-sm text-muted">No jobs yet.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {recentJobs.map((j) => (
                    <li key={j.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                        <span className="font-mono text-ink">{j.type}</span>
                        <span className="text-faint" title={new Date(j.createdAt).toLocaleString()}>{formatRelative(j.createdAt)}</span>
                      </p>
                      <JobProgress compact jobId={j.id} initial={{ status: j.status, progressPct: j.progressPct, currentStep: j.currentStep, attempts: j.attempts, error: j.error, result: j.result }} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
