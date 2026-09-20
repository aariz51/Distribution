import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProduct, listBrandAssets } from "@/lib/products";
import { db, desc, eq, jobs } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { PaletteCard } from "@/components/PaletteCard";
import { AssetUploader } from "@/components/AssetUploader";
import { JobProgress } from "@/components/JobProgress";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const product = await getProduct(session.accountId, id).catch(() => null);
  if (!product) notFound();
  const brandAssets = await listBrandAssets(id);
  const recentJobs = await db.select().from(jobs).where(eq(jobs.productId, id)).orderBy(desc(jobs.createdAt)).limit(10);
  const logo = brandAssets.find((a) => a.kind === "logo");
  const screens = brandAssets.filter((a) => a.kind === "screenshot");

  return (
    <>
      <Nav email={session.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="flex items-start gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.url} alt="" className="h-16 w-16 rounded-xl border border-zinc-200 object-cover" />
          ) : (
            <span className="h-16 w-16 rounded-xl border border-dashed border-zinc-300" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{product.product.name}</h1>
            <p className="text-zinc-600">{product.product.tagline}</p>
            <p className="mt-1 text-xs text-zinc-500">profile v{product.version} · {product.product.category.primary} · {product.product.platforms.join(", ")}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-medium">Features (priority order)</h2>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                {product.product.features.map((f) => (
                  <li key={f.id}><span className="font-medium">{f.title}</span>{f.detail ? <span className="text-zinc-600"> — {f.detail}</span> : null}</li>
                ))}
              </ol>
              <p className="mt-4 text-sm text-zinc-600"><span className="font-medium text-zinc-800">Audience.</span> {product.product.audience.summary}</p>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Screenshots <span className="text-zinc-400">({screens.length})</span></h2>
                <AssetUploader productId={id} />
              </div>
              {screens.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600">No screenshots yet.</p>
              ) : (
                <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {screens.map((s) => (
                    <li key={s.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt="" className="aspect-[9/19] w-full object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-medium">Content library</h2>
              <p className="mt-2 text-sm text-zinc-600">Promo cuts, clips, thumbnails and copy appear here as jobs finish. Generation is wired in the next phase.</p>
            </section>
          </div>

          <div className="space-y-6">
            <PaletteCard productId={id} palette={product.brand.palette} hasAssets={brandAssets.length > 0} />
            <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-medium">Jobs</h2>
              {recentJobs.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">No jobs yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recentJobs.map((j) => (
                    <li key={j.id}>
                      <p className="mb-1 text-xs text-zinc-500">{j.type} · {j.createdAt.toLocaleString()}</p>
                      <JobProgress
                        jobId={j.id}
                        initial={{ status: j.status, progressPct: j.progressPct, currentStep: j.currentStep, attempts: j.attempts, error: (j.error as { message?: string; step?: string | null } | null) ?? null, result: j.result }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
              <h2 className="font-medium">Content preferences</h2>
              <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs text-zinc-600">
                <dt>Caption preset</dt><dd>{product.contentPreferences.captionPresetId}</dd>
                <dt>Voice</dt><dd>{product.contentPreferences.voice}</dd>
                <dt>People policy</dt><dd>{product.contentPreferences.peoplePolicy}</dd>
                <dt>Clips per source</dt><dd>{product.contentPreferences.clipsPerSource}</dd>
                <dt>Timezone</dt><dd>{product.publishing.timezone}</dd>
              </dl>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
