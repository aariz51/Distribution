import { SourcesInfo, logger } from "@distribution/core";
import { canonicalChannel } from "@distribution/media";
import { and, eq, jobs, products, sql, type Db } from "@distribution/db";
import type { JobQueue } from "@distribution/jobs";

/** Persisted job history throttles each channel across restarts and worker instances. */
export async function enqueueConnectedSourceChecks(db: Db, queue: JobQueue) {
  const candidates = await db.select({ id: products.id }).from(products).where(sql`jsonb_array_length(coalesce(${products.sources}->'connected', '[]'::jsonb)) > 0`);
  let queued = 0;
  for (const candidate of candidates) {
    try {
      queued += await db.transaction(async tx => {
        const product = (await tx.select().from(products).where(eq(products.id, candidate.id)).for("update"))[0];
        if (!product) return 0;
        const connected = SourcesInfo.parse(product.sources).connected.filter(source => source.kind === "youtube_channel");
        let count = 0;
        for (const source of connected) {
          const channelUrl = canonicalChannel(source.url);
          const recent = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.productId, product.id), eq(jobs.type, "source.discover"), sql`${jobs.payload}->>'channelUrl' = ${channelUrl}`, sql`(${jobs.createdAt} > now() - interval '24 hours' or ${jobs.status} in ('queued', 'started', 'progress', 'retrying'))`)).limit(1);
          if (recent.length) continue;
          await queue.enqueueInTransaction(tx, "source.discover", { productId: product.id, channelUrl }, { productId: product.id, singletonKey: `discover:${product.id}:${channelUrl}` });
          count++;
        }
        return count;
      });
    } catch (error) { logger.warn({ productId: candidate.id, error: String(error) }, "connected source scheduling failed"); }
  }
  return queued;
}
