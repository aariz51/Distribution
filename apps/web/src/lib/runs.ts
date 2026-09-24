import { toProfile } from "./products";
import { newId, ValidationError, logger, redact } from "@distribution/core";
import { and, db, eq, features, products, projects, sourceVideos, jobs, sql } from "./db";
import { getQueue } from "./queue";

/** The project, source state and queue message commit together. */
export async function startRun(productId: string, sourceId: string) {
  const queue = await getQueue();
  return db.transaction(async tx => {
    const lease = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`source-processing:${sourceId}`}, 0)) as locked`);
    if (!lease.rows[0]?.locked) throw new ValidationError("Source processing is still stopping or running. Try again once it finishes.");
    const source = (await tx.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))).for("update"))[0];
    if (!source) throw new ValidationError("source not found");
    const active = await tx.select({ id: jobs.id }).from(jobs).where(and(
      sql`(${jobs.sourceId} = ${sourceId} or ${jobs.payload}->>'sourceId' = ${sourceId}
        or ${jobs.projectId} in (select id from projects where source_id = ${sourceId}))`,
      sql`${jobs.status} in ('queued', 'started', 'progress', 'retrying')`,
    )).limit(1);
    if (active.length) throw new ValidationError("source is already being processed");
    const product = (await tx.select().from(products).where(eq(products.id, productId)).for("share"))[0];
    if (!product) throw new ValidationError("product not found");
    const featureRows = await tx.select().from(features).where(eq(features.productId, productId));
    const profileSnapshot = toProfile(product, featureRows);
    const projectId = newId();
    await tx.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: product.version, sourceId, status: "running", params: { profileSnapshot, clipsPerSource: product.contentPreferences.clipsPerSource } });
    await tx.update(sourceVideos).set({ status: "queued", failureReason: null }).where(eq(sourceVideos.id, sourceId));
    const job = await queue.enqueueInTransaction(tx, "source.ingest", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `ingest:${sourceId}:${projectId}` });
    return { projectId, ...job };
  });
}

/** An imported source is useful even when the processing queue is unavailable. */
export async function startImportedSource(productId: string, sourceId: string) {
  try {
    return { ...await startRun(productId, sourceId), processing: { status: "queued" as const } };
  } catch (error) {
    const message = "Source saved, but processing could not start. Retry from the source list.";
    logger.error({ sourceId, error: redact(error instanceof Error ? error.message : String(error)) }, "import processing submission failed");
    try {
      await db.update(sourceVideos).set({ status: "failed", failureReason: message, updatedAt: sql`now()` })
        .where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId), sql`${sourceVideos.status} in ('discovered', 'failed')`));
    } catch (diagnosticError) {
      logger.error({ sourceId, error: redact(String(diagnosticError)) }, "could not save import processing diagnostic");
    }

    return { processing: { status: "failed" as const, error: message } };
  }
}
