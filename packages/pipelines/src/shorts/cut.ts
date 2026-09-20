import path from "node:path";
import { NormalizedTranscript, PipelineError, newId, type TranscriptWord } from "@distribution/core";
import { assets, candidates, eq, sql, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, run, probeMedia, chunkWords, generateSrt, buildRenderCommand, cropOffsets, parseFacetrackOutput } from "@distribution/media";
import { getLlm } from "@distribution/providers";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, loadSource, paletteOf, withScratch, transcriptTextBetween } from "./common";
import { runCaptions, runFacetrack, runTitleBar } from "./sidecars";
import { TITLE_PROMPT, fallbackTitle, fillPrompt } from "./ranking";

const DELIVERY = { w: 1080, h: 1920 };

/**
 * shorts.cut — the AutoShorts cut, as a job: face-tracked 9:16 crop, brand-coloured
 * PNG-overlay captions, one retry without captions on ffmpeg failure, optional
 * title banner, then thumbnail + copy jobs. Each output is an asset row in review.
 */
export async function shortsCut(ctx: JobContext<"shorts.cut">) {
  const { productId, projectId, candidateId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const cand = (await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1))[0];
  if (!cand) throw new PipelineError("candidate not found", { step: "load" });
  const tr = (await db.select().from(transcripts).where(eq(transcripts.id, cand.transcriptId)).limit(1))[0];
  if (!tr) throw new PipelineError("transcript not found", { step: "load" });
  const transcript = NormalizedTranscript.parse({ language: tr.language, duration: tr.durationSec, speakers: tr.speakers, words: tr.words, segments: tr.segments });
  const source = await loadSource(db, tr.sourceId);
  if (!source.storageKey) throw new PipelineError("source file missing", { step: "load" });
  const profile = await loadProfile(db, productId);
  const prefs = profile.contentPreferences;
  const palette = paletteOf(profile);
  const src = await storage.localPathFor(source.storageKey);
  const probe = await probeMedia(src, { signal: ctx.signal });
  const start = cand.startSec;
  const end = cand.endSec;
  const duration = end - start;

  const result = await withScratch("cut", async (scratch) => {
    await ctx.progress(5, "facetrack", "tracking the speaker");
    const planJson = await runFacetrack(src, start, end, { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "facetrack") });
    const plan = parseFacetrackOutput(planJson);
    await ctx.event("info", plan ? `crop: ${plan.summary}` : "crop: centred (no face track)", undefined, "facetrack");

    await ctx.progress(20, "captions", `rendering captions (${prefs.captionPresetId})`);
    const words = transcript.words as TranscriptWord[];
    const chunks = chunkWords(words, start, end);
    let overlay: string | null = null;
    if (chunks.length && probe.hasVideo) {
      try {
        overlay = await runCaptions(
          {
            width: DELIVERY.w,
            height: DELIVERY.h,
            duration,
            style: prefs.captionPresetId,
            chunks,
            outDir: path.join(scratch, "captions"),
            colors: prefs.captionUseBrandColors ? { highlightColor: palette.accent, strokeColor: palette.ground } : undefined,
          },
          { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "captions") },
        );
      } catch (err) {
        await ctx.event("warn", `captions unavailable, rendering clean: ${err instanceof Error ? err.message : err}`, undefined, "captions");
      }
    }
    const srt = generateSrt(words, start, end);

    const flat = path.join(scratch, "flat.mp4");
    const renderOnce = async (withCaptions: boolean) => {
      const argv = buildRenderCommand({ sourcePath: src, startSec: start, endSec: end, outputPath: flat, captionOverlay: withCaptions ? overlay : null, hasVideo: probe.hasVideo, cropOffsets: plan ? cropOffsets(plan) : "", supportsDrawtext: false });
      await run(bin("ffmpeg"), ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:2", ...argv], {
        timeoutMs: 60 * 60_000,
        signal: ctx.signal,
        step: "render",
        onStderrLine: (line) => {
          const m = /^out_time_ms=(\d+)/.exec(line);
          if (m) void ctx.progress(30 + Math.min(40, Math.round((Number(m[1]) / 1_000_000 / Math.max(duration, 1)) * 40)), "render", `encoding ${Math.round(Number(m[1]) / 1_000_000)}s / ${Math.round(duration)}s`);
        },
      });
    };
    await ctx.progress(30, "render", "encoding 9:16 clip");
    try {
      await renderOnce(Boolean(overlay));
    } catch (err) {
      if (!overlay) throw err;
      await ctx.event("warn", `render with captions failed, retrying without: ${err instanceof Error ? err.message : err}`, undefined, "render");
      await renderOnce(false);
      overlay = null;
    }

    let finalPath = flat;
    let title: string | null = null;
    if (prefs.titleBanner) {
      await ctx.progress(72, "title", "writing title");
      const excerpt = transcriptTextBetween(transcript, start, end).slice(0, 1500);
      try {
        const res = await getLlm().chat(
          { messages: [{ role: "user", content: fillPrompt(TITLE_PROMPT, { hook: cand.hook, transcript_excerpt: excerpt }) }], maxTokens: 64, temperature: 0.4 },
          { purpose: "title", signal: ctx.signal, log: ctx.log, recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "chat", purpose: "title", inputTokens: u.inputTokens, outputTokens: u.outputTokens, usdEstimate: u.usdEstimate }) },
        );
        title = res.text.trim().split("\n")[0]!.replace(/^["']|["']$/g, "").slice(0, 90) || null;
      } catch (err) {
        await ctx.event("warn", `title model failed, using hook: ${err instanceof Error ? err.message : err}`, undefined, "title");
      }
      title ??= fallbackTitle(cand.hook, profile.product.name);
      try {
        finalPath = await runTitleBar(flat, title, path.join(scratch, "titled.mp4"), { signal: ctx.signal, colors: { fill: "#FFFFFF", stroke: palette.ground }, onLog: (l) => void ctx.event("debug", l, undefined, "title") });
      } catch (err) {
        await ctx.event("warn", `title banner failed soft: ${err instanceof Error ? err.message : err}`, undefined, "title");
        finalPath = flat;
      }
    }

    await ctx.progress(90, "store", "storing clip");
    const assetId = newId();
    const clipKey = keys.clip(projectId, candidateId, finalPath === flat ? "flat" : "titled");
    await storage.putFile(clipKey, finalPath, { contentType: "video/mp4" });
    if (finalPath !== flat) await storage.putFile(keys.clip(projectId, candidateId, "flat"), flat, { contentType: "video/mp4" });
    const srtKey = keys.clipArtifact(projectId, candidateId, "captions.srt");
    await storage.putBuffer(srtKey, Buffer.from(srt), { contentType: "application/x-subrip" });
    const out = await probeMedia(await storage.localPathFor(clipKey), { signal: ctx.signal });
    await db.insert(assets).values({
      id: assetId,
      productId,
      projectId,
      type: "clip",
      sourceId: source.id,
      candidateId,
      storageKey: clipKey,
      mimeType: "video/mp4",
      width: out.width,
      height: out.height,
      durationSec: out.durationSec,
      sizeBytes: out.sizeBytes,
      status: "review",
      approvalState: "pending",
      profileVersion: profile.version,
      jobId: ctx.jobId,
      metadata: { hook: cand.hook, score: cand.score, rank: cand.rank, startSec: start, endSec: end, title, captions: overlay ? prefs.captionPresetId : "none", crop: plan ? "tracked" : "center", srtKey, featureIds: cand.featureIds },
    });
    return { assetId, clipKey, title, captions: Boolean(overlay), crop: plan ? "tracked" : "center" };
  });

  await ctx.queue.enqueue("shorts.thumbnail", { productId, projectId, assetId: result.assetId }, { productId, projectId, assetId: result.assetId, singletonKey: `thumb:${result.assetId}` });
  const platforms = profile.publishing.cadence.map((c) => c.platform);
  await ctx.queue.enqueue("copy.generate", { productId, assetId: result.assetId, platforms: platforms.length ? [...new Set(platforms)] : ["instagram", "x", "youtube", "linkedin", "tiktok"] }, { productId, assetId: result.assetId, singletonKey: `copy:${result.assetId}` });
  await db.execute(sql`update projects set status = case when exists (select 1 from candidates c join assets a on a.candidate_id = c.id where c.project_id = ${projectId} and c.selected) then 'completed' else status end, updated_at = now() where id = ${projectId}`);
  await ctx.progress(100, "done", "clip in review");
  return result;
}
