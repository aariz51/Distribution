import { newId, PipelineError, SourcesInfo } from "@distribution/core";
import { and, connectedSources, eq, features, inArray, products, projects, sourceVideos, sql, toProductProfile } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { canonicalChannel, discoverChannel } from "@distribution/media";

export async function sourceDiscover(ctx: JobContext<"source.discover">) {
  const { productId } = ctx.payload;
  const url = canonicalChannel(ctx.payload.channelUrl);
  const product = (await ctx.db.select().from(products).where(eq(products.id, productId)))[0];
  const saved = product && SourcesInfo.parse(product.sources).connected.find(source => source.kind === "youtube_channel" && canonicalChannel(source.url) === url);
  if (!saved) throw new PipelineError("Channel is not connected to this product", { step: "discovery" });
  await ctx.progress(5, "discovery", "Reading connected channel videos");
  const videos = await discoverChannel(url, ctx.signal);
  ctx.signal.throwIfAborted();
  const result = await ctx.db.transaction(async tx => {
    const current = (await tx.select().from(products).where(eq(products.id, productId)).for("update"))[0];
    const connection = current && SourcesInfo.parse(current.sources).connected.find(source => source.kind === "youtube_channel" && canonicalChannel(source.url) === url);
    if (!connection) throw new PipelineError("Channel was disconnected during discovery", { step: "discovery" });
    const existing = videos.length ? await tx.select({ url: sourceVideos.url }).from(sourceVideos).where(and(eq(sourceVideos.productId, productId), inArray(sourceVideos.url, videos.map(v => v.url)))) : [];
    const known = new Set(existing.map(v => v.url));
    const fresh = videos.filter(v => !known.has(v.url));
    ctx.signal.throwIfAborted();
    const inserted = fresh.map(video => ({ id: newId(), productId, kind: "youtube" as const, platform: "youtube", ...video, rights: connection.rights, status: connection.autoQueue ? "queued" as const : "discovered" as const, probe: { discoveredFrom: url } }));
    if (inserted.length) await tx.insert(sourceVideos).values(inserted);
    if (connection.autoQueue && inserted.length) {
      const profileSnapshot = toProductProfile(current!, await tx.select().from(features).where(eq(features.productId, productId)));
      for (const source of inserted) {
        ctx.signal.throwIfAborted();
        const projectId = newId();
        await tx.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: profileSnapshot.version, sourceId: source.id, status: "running", params: { profileSnapshot, clipsPerSource: profileSnapshot.contentPreferences.clipsPerSource } });
        await ctx.queue.enqueueInTransaction(tx, "source.ingest", { productId, sourceId: source.id, projectId }, { productId, sourceId: source.id, projectId, singletonKey: `ingest:${source.id}:${projectId}` });
      }
    }
    const record = (await tx.select().from(connectedSources).where(and(eq(connectedSources.productId, productId), eq(connectedSources.url, url))))[0];
    if (record) await tx.update(connectedSources).set({ lastPolledAt: sql`now()`, autoQueue: connection.autoQueue, updatedAt: sql`now()` }).where(eq(connectedSources.id, record.id));
    else await tx.insert(connectedSources).values({ id: newId(), productId, kind: "youtube_channel", url, lastPolledAt: new Date(), autoQueue: connection.autoQueue });
    return { found: videos.length, added: fresh.length, queued: connection.autoQueue ? fresh.length : 0, existing: videos.length - fresh.length };
  });
  await ctx.progress(100, "done", `${result.added} new sources added; ${result.existing} already saved`);
  return result;
}
