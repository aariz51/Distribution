import { ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { and, db, eq, jobs, sourceVideos, sql } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string; sourceId: string }> };
export const POST = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id: productId, sourceId } = await ctx.params;
  await getProduct(session.accountId, productId);
  const queue = await getQueue();
  const result = await db.transaction(async tx => {
    const lease = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`source-processing:${sourceId}`}, 0)) as locked`);
    if (!lease.rows[0]?.locked) throw new ValidationError("Source processing is active. Wait for it to finish.");
    const source = (await tx.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))).for("update"))[0];
    if (!source) throw new NotFound("source");
    const active = await tx.select({ id: jobs.id }).from(jobs).where(and(sql`(${jobs.sourceId} = ${sourceId} or ${jobs.payload}->>'sourceId' = ${sourceId} or ${jobs.projectId} in (select id from projects where source_id = ${sourceId}))`, sql`${jobs.status} in ('queued', 'started', 'progress', 'retrying')`)).limit(1);
    if (active.length) throw new ValidationError("Source processing is active. Wait for it to finish.");
    return queue.enqueueInTransaction(tx, "source.probe", { productId, sourceId }, { productId, sourceId, singletonKey: `probe:${sourceId}` });
  });
  return json(result, { status: 202 });
});
