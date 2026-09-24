import { newId, PipelineError } from "@distribution/core";
import { and, eq, inArray, jobs, products, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { normalizeSearchQuery, searchYoutube } from "@distribution/media";

export async function sourceSearch(ctx: JobContext<"source.search">) {
  const { productId } = ctx.payload;
  const query = normalizeSearchQuery(ctx.payload.query);
  const product = (await ctx.db.select({ id: products.id }).from(products).where(eq(products.id, productId)))[0];
  if (!product) throw new PipelineError("Product not found", { step: "search" });
  await ctx.progress(5, "search", "Finding long-form YouTube discussions");
  const videos = await searchYoutube(query, ctx.signal);
  ctx.signal.throwIfAborted();
  const result = await ctx.db.transaction(async tx => {
    const parent = (await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, ctx.jobId)).for("update"))[0];
    if (!parent || parent.status === "cancelled") throw new PipelineError("Search cancelled", { step: "search" });
    const current = (await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for("update"))[0];
    if (!current) throw new PipelineError("Product no longer exists", { step: "search" });
    const existing = videos.length ? await tx.select({ url: sourceVideos.url }).from(sourceVideos).where(and(eq(sourceVideos.productId, productId), inArray(sourceVideos.url, videos.map(v => v.url)))) : [];
    const known = new Set(existing.map(v => v.url));
    const fresh = videos.filter(v => !known.has(v.url));
    ctx.signal.throwIfAborted();
    if (fresh.length) await tx.insert(sourceVideos).values(fresh.map(video => ({ id: newId(), productId, ...video, kind: "youtube" as const, platform: "youtube", rights: "unknown" as const, status: "discovered" as const, probe: { discovery: { kind: "topic-search", query, at: new Date().toISOString() }, screening: { status: "pending", music: "unchecked", femaleFigures: "unchecked" } } })));
    const candidates = videos.length ? await tx.select().from(sourceVideos).where(and(eq(sourceVideos.productId, productId), inArray(sourceVideos.url, videos.map(v => v.url)))) : [];
    let checking = 0;
    for (const source of candidates) {
      if (source.status === "archived") continue;
      const active = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.sourceId, source.id), sql`${jobs.status} in ('queued','started','progress','retrying')`)).limit(1);
      if (active.length) continue;
      await ctx.queue.enqueueInTransaction(tx, "source.probe", { productId, sourceId: source.id, qualificationBatch: ctx.jobId }, { productId, sourceId: source.id, singletonKey: `qualify:${source.id}` });
      checking++;
    }
    return { found: videos.length, added: fresh.length, existing: existing.length, checking, query, screening: "pending" };
  });
  await ctx.progress(100, "done", `${result.checking} candidates queued for license checks. Up to 3 permitted videos will receive full content screening.`);
  return result;
}
