import { PipelineError, redact } from "@distribution/core";
import { and, eq, jobs, products, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { probeMedia, probeYoutube } from "@distribution/media";
import { getStorage, storedContentHash } from "@distribution/storage";
import { loadSource } from "./common";
import { withSourceLease } from "./source-lease";
import { SCREENING_POLICY_VERSION, hasCompleteScreeningPass } from "./screening-report";

/** Search qualification checks rights, then queues bounded original screening. No paid generation. */
export async function sourceProbe(ctx: JobContext<"source.probe">) {
  return withSourceLease(ctx, ctx.payload.sourceId, async signal => {
    const source = await loadSource(ctx.db, ctx.payload.sourceId);
    if (source.productId !== ctx.payload.productId) throw new PipelineError("Source belongs to another product", { step: "probe" });
    try {
      await ctx.progress(5, "probe", "Reading source metadata");
      if (source.url) {
        const meta = await probeYoutube(source.url, signal);
        signal.throwIfAborted();
        await ctx.db.update(sourceVideos).set({ title: meta.title, creator: meta.uploader, durationSec: meta.duration, licenseText: meta.license, platform: "youtube", externalId: meta.externalId, rights: source.rights === "unknown" && meta.reuseAllowed ? "licensed" : source.rights, failureReason: null, updatedAt: sql`now()` }).where(eq(sourceVideos.id, source.id));
      } else if (source.storageKey) {
        const meta = await probeMedia(await getStorage().localPathFor(source.storageKey), { signal });
        if (!meta.hasVideo || meta.durationSec <= 0) throw new PipelineError("Source does not contain a playable video", { step: "probe" });
        signal.throwIfAborted();
        await ctx.db.update(sourceVideos).set({ durationSec: meta.durationSec, probe: { ...source.probe, ...meta }, failureReason: null, updatedAt: sql`now()` }).where(eq(sourceVideos.id, source.id));
      } else throw new PipelineError("Source has no URL or stored file", { step: "probe" });
      let qualification: string | undefined;
      if (ctx.payload.qualificationBatch) {
        const previous = source.probe?.screening as Record<string, unknown> | undefined;
        const originalKey = typeof source.probe?.originalStorageKey === "string" ? source.probe.originalStorageKey : source.storageKey;
        const currentHash = previous && originalKey ? await storedContentHash(originalKey, signal).catch(() => null) : null;
        const batch = ctx.payload.qualificationBatch;
        qualification = await ctx.db.transaction(async tx => {
          const parent = (await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, ctx.jobId)).for("update"))[0];
          if (!parent || parent.status === "cancelled") throw new PipelineError("Qualification cancelled", { step: "qualification" });
          await tx.select({ id: products.id }).from(products).where(eq(products.id, source.productId)).for("update");
          const current = (await tx.select().from(sourceVideos).where(eq(sourceVideos.id, source.id)).for("update"))[0]!;
          let state = "needs-rights";
          if (current.rights !== "unknown") {
            const report = current.probe?.screening as Record<string, unknown> | undefined;
            if (report && currentHash && hasCompleteScreeningPass(report, currentHash)) state = "screened";
            else if (currentHash && report?.contentSha256 === currentHash && report?.policyVersion === SCREENING_POLICY_VERSION && ["rejected", "uncertain"].includes(String(report.status))) state = "blocked";
            else {
              const batchJobs = await tx.select({ sourceId: jobs.sourceId }).from(jobs).where(and(eq(jobs.type, "source.ingest"), sql`${jobs.payload}->>'qualificationBatch' = ${batch}`));
              if (batchJobs.some(j => j.sourceId === source.id)) state = "screening-queued";
              else if (batchJobs.length >= 3) state = "batch-limit";
              else {
                signal.throwIfAborted();
                await ctx.queue.enqueueInTransaction(tx, "source.ingest", { productId: source.productId, sourceId: source.id, screenOnly: true, qualificationBatch: batch }, { productId: source.productId, sourceId: source.id, singletonKey: `screen:${source.id}` });
                state = "screening-queued";
              }
            }
          }
          await tx.update(sourceVideos).set({ probe: sql`coalesce(${sourceVideos.probe}, '{}'::jsonb) || ${JSON.stringify({ qualification: { state, batch, at: new Date().toISOString() } })}::jsonb`, updatedAt: sql`now()` }).where(eq(sourceVideos.id, source.id));
          return state;
        });
      }
      await ctx.progress(100, "done", qualification === "needs-rights" ? "No reuse license verified; confirm permission before screening" : qualification === "screening-queued" ? "Permitted source queued for complete audio and video screening" : qualification === "batch-limit" ? "License verified; this search's three-video screening limit was reached" : "Source metadata updated");
      return { sourceId: source.id, qualification };
    } catch (error) {
      if (!signal.aborted) await ctx.db.update(sourceVideos).set({ failureReason: redact(error instanceof Error ? error.message : String(error)), updatedAt: sql`now()` }).where(eq(sourceVideos.id, source.id));
      throw error;
    }
  });
}
