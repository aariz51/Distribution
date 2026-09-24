import { screenOriginal } from "./screening";
import { transcriptCacheKey } from "./transcript-cache";
import { withSourceLease } from "./source-lease";
import path from "node:path";
import { PipelineError, newId } from "@distribution/core";
import { eq, projects, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { extractAudio16k } from "@distribution/media";
import { getStt } from "@distribution/providers";
import { getStorage, keys } from "@distribution/storage";
import { latestTranscript, loadProfile, loadSource, withScratch } from "./common";

/** source.transcribe — 16 kHz mono wav → configured STT → transcripts row → shorts.rank. */
export async function sourceTranscribe(ctx: JobContext<"source.transcribe">) {
  return withSourceLease(ctx, ctx.payload.sourceId, signal => sourceTranscribeLocked({ ...ctx, signal }));
}

async function sourceTranscribeLocked(ctx: JobContext<"source.transcribe">) {
  const { productId, sourceId, projectId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const source = await loadSource(db, sourceId);
  if (source.productId !== productId) throw new PipelineError("Source does not belong to this product", { step: "load" });
  if (projectId) {
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    if (!project || project.productId !== productId || project.sourceId !== sourceId) throw new PipelineError("Source project mismatch", { step: "load" });
  }
  const profile = await loadProfile(db, productId, projectId);
  if (!source.storageKey) throw new Error("source not ingested");

  await screenOriginal(ctx, sourceId, typeof source.probe?.originalStorageKey === "string" ? source.probe.originalStorageKey : source.storageKey);
  const local = await storage.localPathFor(source.storageKey);
  const stt = getStt(ctx.payload.provider);
  const cacheKey = await transcriptCacheKey(local, stt.id, profile.contentPreferences.languages[0], ctx.signal);
  const existing = await latestTranscript(db, sourceId, cacheKey);
  let transcriptId = existing?.id;
  if (!existing) {
    const duration = source.durationSec ?? 0;
    const result = await withScratch("stt", async (scratch) => {
      const wav = path.join(scratch, "audio-16k.wav");
      await ctx.progress(2, "extract_audio", "extracting audio");
      await extractAudio16k(local, wav, { signal: ctx.signal, onProgress: (sec) => void ctx.progress(2 + Math.min(8, Math.round((sec / Math.max(duration, 1)) * 8)), "extract_audio", `extracting audio ${Math.round(sec)}s`) });
      await ctx.progress(10, "transcribe", `transcribing with ${stt.id}`);
      return stt.transcribe(wav, duration, {
        signal: ctx.signal,
        workDir: scratch,
        language: profile.contentPreferences.languages[0],
        onProgress: (pct, msg) => void ctx.progress(10 + Math.round(pct * 0.85), "transcribe", msg),
        recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "stt", seconds: u.seconds, usdEstimate: u.usdEstimate }),
      });
    });
    transcriptId = newId();
    const key = keys.transcript(productId, sourceId, transcriptId);
    await storage.putBuffer(key, Buffer.from(JSON.stringify(result)), { contentType: "application/json" });
    await db.insert(transcripts).values({ id: transcriptId, sourceId, engine: stt.id, cacheKey, language: result.language, durationSec: result.duration, words: result.words, segments: result.segments, speakers: result.speakers, storageKey: key });
    await ctx.event("info", `transcript: ${result.words.length} words, ${result.segments.length} segments, ${result.speakers.length} speakers`, undefined, "transcribe");
  } else {
    await ctx.event("info", "reusing existing transcript", undefined, "transcribe");
  }
  await ctx.queue.enqueue("shorts.rank", { productId, projectId, transcriptId: transcriptId! }, { productId, projectId, sourceId, singletonKey: `rank:${projectId}` });
  await ctx.progress(100, "done", "queued ranking");
  return { transcriptId };
}
