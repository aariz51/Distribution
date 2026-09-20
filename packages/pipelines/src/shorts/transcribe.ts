import path from "node:path";
import { PipelineError, newId } from "@distribution/core";
import { eq, projects, sourceVideos, sql, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { extractAudio16k } from "@distribution/media";
import { getStt } from "@distribution/providers";
import { getStorage, keys } from "@distribution/storage";
import { withScratch } from "../common/scratch";
import { requireProfile } from "../common/profile";

/** source.transcribe — 16 kHz mono wav → provider → transcripts row (+ JSON in storage) → shorts.rank */
export async function sourceTranscribe(ctx: JobContext<"source.transcribe">): Promise<Record<string, unknown>> {
  const { productId, sourceId, projectId, provider } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const profile = await requireProfile(db, productId);
  const src = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)).limit(1))[0];
  if (!src?.storageKey) throw new PipelineError("source not ready", { step: "load" });
  await db.update(projects).set({ status: "running", updatedAt: sql`now()` }).where(eq(projects.id, projectId));

  const existing = (await db.select().from(transcripts).where(eq(transcripts.sourceId, sourceId)).limit(1))[0];
  if (existing) {
    await ctx.event("info", `reusing transcript ${existing.id} (${existing.engine})`, undefined, "reuse");
    await ctx.queue.enqueue("shorts.rank", { productId, projectId, transcriptId: existing.id }, { productId, projectId, singletonKey: `shorts.rank:${projectId}` });
    return { transcriptId: existing.id, reused: true };
  }

  const source = await storage.localPathFor(src.storageKey);
  const durationSec = src.durationSec ?? 0;
  const stt = getStt(provider);
  await ctx.event("info", `transcribing with ${stt.id}`, undefined, "transcribe");

  const transcript = await withScratch(`stt-${sourceId.slice(0, 8)}`, async (dir) => {
    const wav = path.join(dir, "audio-16k.wav");
    await ctx.progress(2, "extract_audio", "extracting audio");
    await extractAudio16k(source, wav, { signal: ctx.signal, onProgress: (sec) => void ctx.progress(2 + Math.min(8, (sec / Math.max(1, durationSec)) * 8), "extract_audio", `extracting audio ${Math.round(sec)}s`) });
    return stt.transcribe(wav, durationSec, {
      signal: ctx.signal,
      workDir: dir,
      language: profile.contentPreferences.languages[0],
      onProgress: (pct, msg) => void ctx.progress(10 + pct * 0.85, "transcribe", msg),
      recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "stt", purpose: "transcribe", seconds: u.seconds, usdEstimate: u.usdEstimate }),
    });
  });

  const transcriptId = newId();
  const key = keys.transcript(productId, sourceId, transcriptId);
  await storage.putBuffer(key, Buffer.from(JSON.stringify(transcript)), { contentType: "application/json" });
  await db.insert(transcripts).values({
    id: transcriptId,
    sourceId,
    engine: stt.id,
    language: transcript.language,
    durationSec: transcript.duration || durationSec,
    words: transcript.words,
    segments: transcript.segments,
    speakers: transcript.speakers,
    storageKey: key,
  });
  await ctx.progress(97, "save", `transcript saved: ${transcript.words.length} words, ${transcript.segments.length} segments`);
  await ctx.queue.enqueue("shorts.rank", { productId, projectId, transcriptId }, { productId, projectId, singletonKey: `shorts.rank:${projectId}` });
  return { transcriptId, words: transcript.words.length, engine: stt.id };
}
