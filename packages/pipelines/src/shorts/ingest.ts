import { screenOriginal } from "./screening";
import { withSourceLease } from "./source-lease";
import path from "node:path";
import { PipelineError, newId, redact } from "@distribution/core";
import { eq, projects, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, run, probeMedia, parseVideoId, probeYoutube, ytdlpAttempts, downloadArgv, parseDownloadOutput, classify, isRetryable as ytRetryable, userMessage } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, loadSource, withScratch } from "./common";
import { runCleanSource } from "./sidecars";
import { saveGeneratedAsset } from "../generated-assets";

/**
 * source.ingest — turn a source row into a stored original: probe (title,
 * licence, rights), enforce the rights gate, download with yt-dlp (the same
 * player-client fallback as youtube.rs), optionally clean, store, then chain
 * to transcription. Uploads skip straight to probe + chain.
 */
export async function sourceIngest(ctx: JobContext<"source.ingest">) {
  return withSourceLease(ctx, ctx.payload.sourceId, signal => sourceIngestLocked({ ...ctx, signal }));
}

async function sourceIngestLocked(ctx: JobContext<"source.ingest">) {
  const { productId, sourceId, projectId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const source = await loadSource(db, sourceId);
  if (source.productId !== productId) throw new PipelineError("source belongs to another product", { step: "load" });
  if (projectId) {
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project || project.productId !== productId || project.sourceId !== sourceId) throw new PipelineError("source project mismatch", { step: "load" });
  }
  const profile = await loadProfile(db, productId, projectId);
  try {
    await db.update(sourceVideos).set({ status: "downloading", updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));

    let storageKey = typeof source.probe?.originalStorageKey === "string" ? source.probe.originalStorageKey : source.storageKey;
    let originalStorageKey = storageKey;
    if (storageKey && source.rights === "unknown") throw new PipelineError("Confirm source rights before processing stored media", { step: "rights" });
    await withScratch("ingest", async (scratch) => {
      if (source.url && !storageKey) {
        if (!source.url) throw new PipelineError("source has no url", { step: "probe" });
        const id = parseVideoId(source.url);
        await ctx.progress(3, "probe", "reading video metadata");
        const meta = await probeYoutube(source.url, ctx.signal);
        let lastErr: unknown;

        // Rights gate (Gate 2 §5): licensed if YouTube says Creative Commons; otherwise the founder's classification stands.
        const rights = source.rights === "unknown" && meta.reuseAllowed ? "licensed" : source.rights;
        await db
          .update(sourceVideos)
          .set({ title: meta.title, creator: meta.uploader, durationSec: meta.duration, licenseText: meta.license, rights, platform: "youtube", externalId: String(id), updatedAt: sql`now()` })
          .where(eq(sourceVideos.id, sourceId));
        if (rights === "unknown") {
          await db.update(sourceVideos).set({ status: "discovered", failureReason: "Rights unknown: mark the source as owned, licensed, or attest permission before processing.", updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));
          throw new PipelineError("source blocked: rights unknown (not Creative Commons and no attestation)", { retrySafe: false, step: "rights" });
        }

        await ctx.progress(8, "download", `downloading "${meta.title}" (${Math.round(meta.duration)}s)`);
        let downloaded: string | null = null;
        let downloadPct = 8;
        const onDownloadProgress = (line: string) => {
          const m = /\[download\]\s+([\d.]+)%/.exec(line);
          if (m) {
            const pct = 8 + Math.round(Number(m[1]) * 0.6);
            if (pct > downloadPct) {
              downloadPct = pct;
              void ctx.progress(pct, "download", `downloading stream: ${m[1]}%`);
            }
          }
        };
        for (const argv of ytdlpAttempts(downloadArgv(id, scratch, process.env.YTDLP_MAX_FILESIZE))) {
          try {
            const res = await run(bin("yt-dlp"), argv, {
              timeoutMs: 60 * 60_000,
              signal: ctx.signal,
              step: "download",
              onStdoutLine: onDownloadProgress,
              onStderrLine: onDownloadProgress,
            });
            downloaded = parseDownloadOutput(res.stdout);
            if (downloaded) break;
          } catch (err) {
            const details = (err as { details?: { stderrTail?: string[] } }).details;
            const failure = classify((details?.stderrTail ?? []).join("\n"));
            if (!ytRetryable(failure)) throw new PipelineError(userMessage(failure), { retrySafe: false, step: "download", cause: err });
            lastErr = err;
          }
        }
        if (!downloaded) throw new PipelineError(`download failed: ${lastErr instanceof Error ? lastErr.message : "no file"}`, { retrySafe: true, step: "download" });

        await ctx.progress(80, "store", "storing original");
        storageKey = keys.sourceOriginal(productId, sourceId, "mp4");
        await storage.putFile(storageKey, downloaded, { contentType: "video/mp4" });
      }
      if (!storageKey) throw new PipelineError("upload has no stored file", { step: "store" });
      originalStorageKey = storageKey;
      await ctx.progress(81, "screening", "Checking original video and audio");
      await screenOriginal(ctx, sourceId, originalStorageKey);
      if (profile.contentPreferences.cleanSource && !ctx.payload.screenOnly) {
        await ctx.progress(82, "clean", "removing burned-in captions and isolating voice");
        const cleaned = await runCleanSource(await storage.localPathFor(storageKey), path.join(scratch, "clean.mp4"), {
          signal: ctx.signal, onLog: line => void ctx.event("debug", line, undefined, "clean"),
        });
        const checked = await probeMedia(cleaned, { signal: ctx.signal });
        if (!checked.hasVideo || !checked.hasAudio || checked.durationSec <= 0) throw new PipelineError("cleaned source is not valid video with audio", { step: "clean" });
        storageKey = `products/${productId}/sources/${sourceId}/cleaned.mp4`;
        await storage.putFile(storageKey, cleaned, { contentType: "video/mp4" });
      }
    });

    await ctx.progress(88, "probe", "probing stored media");
    const local = await storage.localPathFor(storageKey!);
    const probe = await probeMedia(local, { signal: ctx.signal });
    if (!probe.hasVideo || probe.durationSec <= 0) throw new PipelineError("source is not a playable video", { step: "probe" });
    if (!probe.hasAudio) throw new PipelineError("source has no audio track; nothing to transcribe", { retrySafe: false, step: "probe" });
    await db
      .update(sourceVideos)
      .set({ status: "ready", storageKey, durationSec: probe.durationSec, probe: sql`coalesce(${sourceVideos.probe}, '{}'::jsonb) || ${JSON.stringify({ ...probe, originalStorageKey, cleaned: profile.contentPreferences.cleanSource && !ctx.payload.screenOnly })}::jsonb`, failureReason: null, updatedAt: sql`now()` })
      .where(eq(sourceVideos.id, sourceId));

    const originalProbe = originalStorageKey === storageKey ? probe : await probeMedia(await storage.localPathFor(originalStorageKey!), { signal: ctx.signal });
    await saveGeneratedAsset(db, {
        id: newId(),
        productId,
        projectId: projectId ?? null,
        type: "source_original",
        sourceId,
        storageKey: originalStorageKey!,
        mimeType: "video/mp4",
        width: originalProbe.width,
        height: originalProbe.height,
        durationSec: originalProbe.durationSec,
        sizeBytes: originalProbe.sizeBytes,
        status: "approved",
        approvalState: "approved",
        profileVersion: profile.version,
        jobId: ctx.jobId,
        metadata: { title: source.title },
      });

    if (projectId && !ctx.payload.screenOnly) {
      await ctx.queue.enqueue("source.transcribe", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `transcribe:${projectId}:${sourceId}` });
      await ctx.progress(100, "done", "queued transcription");
    }
    if (ctx.payload.screenOnly) await ctx.progress(100, "done", "Source passed content screening; ready to generate clips");
    return { storageKey, durationSec: probe.durationSec };
  } catch (error) {
    await db.update(sourceVideos).set({ status: "failed", failureReason: redact(error instanceof Error ? error.message : String(error)), updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));
    throw error;
  }
}
