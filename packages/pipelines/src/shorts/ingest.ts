import path from "node:path";
import { PipelineError, newId } from "@distribution/core";
import { assets, eq, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, run, probeMedia, parseVideoId, probeArgv, ytdlpAttempts, parseVideoMeta, downloadArgv, parseDownloadOutput, classify, isRetryable as ytRetryable, userMessage } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, loadSource, withScratch } from "./common";
import { runCleanSource } from "./sidecars";

/**
 * source.ingest — turn a source row into a stored original: probe (title,
 * licence, rights), enforce the rights gate, download with yt-dlp (the same
 * player-client fallback as youtube.rs), optionally clean, store, then chain
 * to transcription. Uploads skip straight to probe + chain.
 */
export async function sourceIngest(ctx: JobContext<"source.ingest">) {
  const { productId, sourceId, projectId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const source = await loadSource(db, sourceId);
  const profile = await loadProfile(db, productId);
  await db.update(sourceVideos).set({ status: "downloading", updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));

  let storageKey = source.storageKey;
  await withScratch("ingest", async (scratch) => {
    if (source.kind === "youtube" || (source.url && !storageKey)) {
      if (!source.url) throw new PipelineError("source has no url", { step: "probe" });
      const id = parseVideoId(source.url);
      await ctx.progress(3, "probe", "reading video metadata");
      let meta: ReturnType<typeof parseVideoMeta> | null = null;
      let lastErr: unknown;
      for (const argv of ytdlpAttempts(probeArgv(id))) {
        try {
          const res = await run(bin("yt-dlp"), argv, { timeoutMs: 120_000, signal: ctx.signal, step: "probe" });
          meta = parseVideoMeta(res.stdout);
          break;
        } catch (err) {
          lastErr = err;
          const details = (err as { details?: { stderrTail?: string[] } }).details;
          const failure = classify((details?.stderrTail ?? []).join("\n"));
          if (!ytRetryable(failure)) throw new PipelineError(userMessage(failure), { retrySafe: false, step: "probe", cause: err });
        }
      }
      if (!meta) throw new PipelineError(`yt-dlp probe failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`, { retrySafe: true, step: "probe" });

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
      for (const argv of ytdlpAttempts(downloadArgv(id, scratch))) {
        try {
          const res = await run(bin("yt-dlp"), [...argv.slice(0, -1), ...(process.env.YTDLP_MAX_FILESIZE ? ["--max-filesize", process.env.YTDLP_MAX_FILESIZE] : []), argv[argv.length - 1]!], {
            timeoutMs: 60 * 60_000,
            signal: ctx.signal,
            step: "download",
            onStdoutLine: (line) => {
              const m = /\[download\]\s+([\d.]+)%/.exec(line);
              if (m) void ctx.progress(8 + Math.round(Number(m[1]) * 0.6), "download", `downloading ${m[1]}%`);
            },
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

      let finalPath = downloaded;
      if (profile.contentPreferences.cleanSource) {
        await ctx.progress(70, "clean", "removing burned-in captions and isolating voice");
        try {
          finalPath = await runCleanSource(downloaded, path.join(scratch, "clean.mp4"), { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "clean") });
        } catch (err) {
          await ctx.event("warn", `clean step failed soft; using original: ${err instanceof Error ? err.message : err}`, undefined, "clean");
        }
      }
      await ctx.progress(80, "store", "storing original");
      storageKey = keys.sourceOriginal(productId, sourceId, "mp4");
      await storage.putFile(storageKey, finalPath, { contentType: "video/mp4" });
    }
    if (!storageKey) throw new PipelineError("upload has no stored file", { step: "store" });
  });

  await ctx.progress(88, "probe", "probing stored media");
  const local = await storage.localPathFor(storageKey!);
  const probe = await probeMedia(local, { signal: ctx.signal });
  if (!probe.hasAudio) throw new PipelineError("source has no audio track; nothing to transcribe", { retrySafe: false, step: "probe" });
  await db
    .update(sourceVideos)
    .set({ status: "ready", storageKey, durationSec: probe.durationSec, probe: probe as unknown as Record<string, unknown>, failureReason: null, updatedAt: sql`now()` })
    .where(eq(sourceVideos.id, sourceId));

  const existing = await db.select({ id: assets.id }).from(assets).where(sql`${assets.sourceId} = ${sourceId} and ${assets.type} = 'source_original'`).limit(1);
  if (!existing[0]) {
    await db.insert(assets).values({
      id: newId(),
      productId,
      projectId: projectId ?? null,
      type: "source_original",
      sourceId,
      storageKey: storageKey!,
      mimeType: "video/mp4",
      width: probe.width,
      height: probe.height,
      durationSec: probe.durationSec,
      sizeBytes: probe.sizeBytes,
      status: "approved",
      approvalState: "approved",
      profileVersion: profile.version,
      jobId: ctx.jobId,
      metadata: { title: source.title },
    });
  }

  if (projectId) {
    await ctx.queue.enqueue("source.transcribe", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `transcribe:${sourceId}` });
    await ctx.progress(100, "done", "queued transcription");
  }
  return { storageKey, durationSec: probe.durationSec };
}
