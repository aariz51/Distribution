import { rename, stat } from "node:fs/promises";
import path from "node:path";
import { PipelineError, newId } from "@distribution/core";
import { assets, eq, projects, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, classify, downloadArgv, isRetryable, parseDownloadOutput, parseVideoId, parseVideoMeta, probeArgv, probeMedia, run, userMessage, ytdlpAttempts, YoutubeDownloadError } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { withScratch } from "../common/scratch";
import { requireProfile } from "../common/profile";
import { runCleanSource } from "./sidecars";

/**
 * source.ingest — bring a source video into storage and probe it.
 *  - youtube: validate id → yt-dlp probe (licence → rights) → rights gate → download with
 *    the 5-player-client fallback (youtube.rs run_ytdlp) → optional clean_source → store.
 *  - upload: the file is already in storage; just probe.
 * Chains source.transcribe when the job belongs to a project.
 */
export async function sourceIngest(ctx: JobContext<"source.ingest">): Promise<Record<string, unknown>> {
  const { productId, sourceId, projectId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const profile = await requireProfile(db, productId);
  const src = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)).limit(1))[0];
  if (!src) throw new PipelineError("source not found");
  await db.update(sourceVideos).set({ status: "downloading", updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));

  const finish = async (storageKey: string, durationSec: number, probe: Record<string, unknown>) => {
    await db.transaction(async (tx) => {
      await tx.update(sourceVideos).set({ status: "ready", storageKey, durationSec, probe, failureReason: null, updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));
      const head = await storage.head(storageKey);
      await tx.insert(assets).values({
        id: newId(),
        productId,
        projectId: projectId ?? null,
        type: "source_original",
        sourceId,
        storageKey,
        mimeType: "video/mp4",
        width: (probe.width as number | null) ?? null,
        height: (probe.height as number | null) ?? null,
        durationSec,
        sizeBytes: head?.size ?? null,
        status: "approved",
        approvalState: "approved",
        profileVersion: profile.version,
        jobId: ctx.jobId,
        metadata: { role: "source" },
      });
    });
    if (projectId) {
      await ctx.queue.enqueue("source.transcribe", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `source.transcribe:${sourceId}:${projectId}` });
    }
  };

  try {
    if (src.kind === "upload" || (src.kind === "connected" && src.storageKey)) {
      if (!src.storageKey) throw new PipelineError("upload has no storage key");
      await ctx.progress(20, "probe", "probing uploaded file");
      const local = await storage.localPathFor(src.storageKey);
      const probe = await probeMedia(local, { signal: ctx.signal });
      if (!probe.hasAudio) throw new PipelineError("source has no audio track; nothing to transcribe", { step: "probe" });
      await finish(src.storageKey, probe.durationSec, probe as unknown as Record<string, unknown>);
      return { kind: "upload", durationSec: probe.durationSec };
    }

    if (!src.url) throw new PipelineError("source has no url");
    const id = parseVideoId(src.url);
    await ctx.progress(5, "probe", "reading video metadata");
    const meta = await ytdlpWithFallback(probeArgv(id), ctx, "probe").then((r) => parseVideoMeta(r.stdout));
    const rights = src.rights === "unknown" && meta.reuseAllowed ? "licensed" : src.rights;
    await db
      .update(sourceVideos)
      .set({ title: meta.title, creator: meta.uploader, durationSec: meta.duration, licenseText: meta.license, rights, externalId: id, platform: "youtube", updatedAt: sql`now()` })
      .where(eq(sourceVideos.id, sourceId));
    if (rights === "unknown") {
      throw new PipelineError(
        "rights unknown: this video is not Creative Commons and no attestation of permission was recorded. Mark the source as owned or attest permission before processing.",
        { retrySafe: false, step: "rights", details: { license: meta.license, uploader: meta.uploader } },
      );
    }
    await ctx.event("info", `rights: ${rights}${meta.license ? ` (licence: ${meta.license})` : ""}`, undefined, "rights");

    const maxBytes = Number(process.env.MAX_SOURCE_BYTES ?? 2 * 1024 * 1024 * 1024);
    const storageKey = keys.sourceOriginal(productId, sourceId, "mp4");
    const result = await withScratch(`ingest-${sourceId.slice(0, 8)}`, async (dir) => {
      await ctx.progress(10, "download", `downloading "${meta.title}" (${Math.round(meta.duration)}s)`);
      const dl = await ytdlpWithFallback(downloadArgv(id, dir), ctx, "download", (line) => {
        const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (m) void ctx.progress(10 + Number(m[1]) * 0.6, "download", `downloading ${m[1]}%`);
      });
      const file = parseDownloadOutput(dl.stdout);
      if (!file) throw new PipelineError("yt-dlp printed no output path", { retrySafe: true, step: "download" });
      const size = (await stat(file)).size;
      if (size > maxBytes) throw new PipelineError(`source is ${Math.round(size / 1e6)} MB, above MAX_SOURCE_BYTES`, { step: "download" });

      let final = file;
      if (profile.contentPreferences.cleanSource) {
        await ctx.progress(72, "clean", "removing burned-in captions and isolating voice");
        try {
          final = await runCleanSource(file, path.join(dir, "clean.mp4"), { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "clean") });
        } catch (err) {
          await ctx.event("warn", `clean_source failed soft; using original: ${err instanceof Error ? err.message : err}`, undefined, "clean");
        }
      }
      await ctx.progress(88, "store", "moving into storage");
      const dest = await storage.localPathFor(storageKey);
      await rename(final, dest).catch(async () => storage.putFile(storageKey, final));
      await storage.commit(storageKey);
      const probe = await probeMedia(dest, { signal: ctx.signal });
      return { probe, size };
    });
    await finish(storageKey, result.probe.durationSec, result.probe as unknown as Record<string, unknown>);
    return { kind: "youtube", title: meta.title, durationSec: result.probe.durationSec, sizeBytes: result.size, rights };
  } catch (err) {
    await db
      .update(sourceVideos)
      .set({ status: "failed", failureReason: err instanceof Error ? err.message : String(err), updatedAt: sql`now()` })
      .where(eq(sourceVideos.id, sourceId));
    if (projectId) await db.update(projects).set({ status: "failed", updatedAt: sql`now()` }).where(eq(projects.id, projectId));
    throw err;
  }
}

/** youtube.rs run_ytdlp: try each player client; only Transient failures advance. */
async function ytdlpWithFallback(args: string[], ctx: JobContext<"source.ingest">, step: string, onLine?: (l: string) => void) {
  let last: YoutubeDownloadError | undefined;
  for (const attempt of ytdlpAttempts(args)) {
    try {
      return await run(bin("yt-dlp"), attempt, { timeoutMs: 60 * 60_000, signal: ctx.signal, step, onStderrLine: onLine, onStdoutLine: onLine });
    } catch (err) {
      const stderr = err instanceof PipelineError ? ((err.details?.stderrTail as string[] | undefined)?.join("\n") ?? err.message) : String(err);
      const failure = classify(stderr);
      last = new YoutubeDownloadError(failure);
      await ctx.event("warn", `${step}: ${userMessage(failure)} (client ${attempt[1]})`, undefined, step);
      if (failure.kind !== "Transient") break;
    }
  }
  throw last ?? new PipelineError(`${step} failed`, { retrySafe: true, step });
}

export { isRetryable };
