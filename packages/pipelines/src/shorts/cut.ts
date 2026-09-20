import path from "node:path";
import { PipelineError, newId, type TranscriptWord } from "@distribution/core";
import { assets, candidates, eq, projects, sourceVideos, sql, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, buildRenderCommand, chunkWords, cropOffsets, generateSrt, parseFacetrackOutput, probeMedia, run } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { withScratch } from "../common/scratch";
import { paletteOf, requireProfile } from "../common/profile";
import { runCaptions, runFacetrack, runTitleBar } from "./sidecars";

/**
 * shorts.cut — one candidate → vertical clip (autoshorts lib.rs cut_candidate_blocking):
 * face-tracked crop → caption chunks → PNG overlay track (brand colours) → ffmpeg →
 * retry once without captions on failure → optional title banner → asset row in `review`
 * → enqueue thumbnail + copy.
 */
export async function shortsCut(ctx: JobContext<"shorts.cut">): Promise<Record<string, unknown>> {
  const { productId, projectId, candidateId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const profile = await requireProfile(db, productId);
  const palette = paletteOf(profile);
  const cand = (await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1))[0];
  if (!cand) throw new PipelineError("candidate not found");
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!project?.sourceId) throw new PipelineError("project has no source");
  const src = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, project.sourceId)).limit(1))[0];
  if (!src?.storageKey) throw new PipelineError("source not ready");
  const tr = (await db.select().from(transcripts).where(eq(transcripts.id, cand.transcriptId)).limit(1))[0];
  if (!tr) throw new PipelineError("transcript not found");
  const words = tr.words as TranscriptWord[];

  const sourcePath = await storage.localPathFor(src.storageKey);
  const probe = await probeMedia(sourcePath, { signal: ctx.signal });
  const duration = cand.endSec - cand.startSec;
  const flatKey = keys.clip(projectId, candidateId, "flat");
  const flatPath = await storage.localPathFor(flatKey);

  const result = await withScratch(`cut-${candidateId.slice(0, 8)}`, async (dir) => {
    // 1. speaker-aware crop (soft)
    await ctx.progress(5, "facetrack", "tracking the speaker for the crop");
    const plan = probe.hasVideo ? parseFacetrackOutput(await runFacetrack(sourcePath, cand.startSec, cand.endSec, { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "facetrack") })) : null;
    await ctx.event("info", plan ? `crop plan: ${plan.summary}` : "centre crop (no reliable face track)", undefined, "facetrack");

    // 2. captions: chunk in TS, rasterise with captions.py, brand colours from the palette
    const chunks = chunkWords(words, cand.startSec, cand.endSec);
    let overlay: string | null = null;
    if (probe.hasVideo && chunks.length) {
      await ctx.progress(20, "captions", `rendering ${chunks.length} caption frames (${profile.contentPreferences.captionPresetId})`);
      try {
        overlay = await runCaptions(
          {
            width: 1080,
            height: 1920,
            duration,
            style: profile.contentPreferences.captionPresetId,
            chunks,
            outDir: path.join(dir, "captions"),
            colors: profile.contentPreferences.captionUseBrandColors ? { textColor: "#ffffff", highlightColor: palette.accent, strokeColor: palette.ground, backgroundColor: undefined } : undefined,
          },
          { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "captions") },
        );
      } catch (err) {
        await ctx.event("warn", `captions unavailable, rendering clean: ${err instanceof Error ? err.message : err}`, undefined, "captions");
      }
    }
    const srt = generateSrt(words, cand.startSec, cand.endSec);
    await storage.putBuffer(keys.clipArtifact(projectId, candidateId, "captions.srt"), Buffer.from(srt), { contentType: "application/x-subrip" });

    // 3. ffmpeg render, with the Rust's one retry without captions
    const render = async (withCaptions: boolean) => {
      const argv = buildRenderCommand({ sourcePath, startSec: cand.startSec, endSec: cand.endSec, outputPath: flatPath, captionOverlay: withCaptions ? overlay : null, hasVideo: probe.hasVideo, cropOffsets: cropOffsets(plan), supportsDrawtext: false });
      await run(bin("ffmpeg"), ["-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:2", ...argv], {
        timeoutMs: Math.max(20 * 60_000, duration * 30_000),
        signal: ctx.signal,
        step: "render",
        onStderrLine: (line) => {
          const m = /^out_time_ms=(\d+)/.exec(line);
          if (m) void ctx.progress(35 + Math.min(45, (Number(m[1]) / 1_000_000 / duration) * 45), "render", `rendering ${Math.round(Number(m[1]) / 1_000_000)}/${Math.round(duration)}s`);
        },
      });
    };
    let captionsBurned = Boolean(overlay);
    try {
      await render(true);
    } catch (err) {
      if (!overlay) throw err;
      await ctx.event("warn", `render with captions failed, retrying without: ${err instanceof Error ? err.message : err}`, undefined, "render");
      captionsBurned = false;
      await render(false);
    }
    await storage.commit(flatKey);

    // 4. optional title banner (brand colours) — fails soft, keeps the flat clip
    let finalKey = flatKey;
    let title: string | null = null;
    if (profile.contentPreferences.titleBanner && probe.hasVideo) {
      title = cand.hook.length > 70 ? `${cand.hook.slice(0, 67).trimEnd()}…` : cand.hook;
      await ctx.progress(85, "title", "adding title banner");
      try {
        const titledKey = keys.clip(projectId, candidateId, "titled");
        const out = await runTitleBar(flatPath, title, await storage.localPathFor(titledKey), { signal: ctx.signal, colors: { fill: "#ffffff", stroke: palette.ground }, onLog: (l) => void ctx.event("debug", l, undefined, "title") });
        if (out) {
          await storage.commit(titledKey);
          finalKey = titledKey;
        }
      } catch (err) {
        await ctx.event("warn", `title banner failed soft: ${err instanceof Error ? err.message : err}`, undefined, "title");
      }
    }
    return { finalKey, captionsBurned, title, plan: plan?.summary ?? null, chunks: chunks.length };
  });

  const outProbe = await probeMedia(await storage.localPathFor(result.finalKey), { signal: ctx.signal });
  const head = await storage.head(result.finalKey);
  const assetId = newId();
  await db.insert(assets).values({
    id: assetId,
    productId,
    projectId,
    type: "clip",
    sourceId: project.sourceId,
    candidateId,
    storageKey: result.finalKey,
    mimeType: "video/mp4",
    width: outProbe.width,
    height: outProbe.height,
    durationSec: outProbe.durationSec,
    sizeBytes: head?.size ?? null,
    status: "review",
    approvalState: "pending",
    profileVersion: profile.version,
    jobId: ctx.jobId,
    metadata: {
      hook: cand.hook,
      rationale: cand.rationale,
      score: cand.score,
      rank: cand.rank,
      startSec: cand.startSec,
      endSec: cand.endSec,
      captionsBurned: result.captionsBurned,
      captionPreset: profile.contentPreferences.captionPresetId,
      title: result.title,
      cropPlan: result.plan,
      paletteUsed: { accent: palette.accent, ground: palette.ground },
    },
  });
  await ctx.progress(96, "save", "clip saved to library");
  await ctx.queue.enqueue("shorts.thumbnail", { productId, projectId, assetId }, { productId, projectId, assetId, singletonKey: `shorts.thumbnail:${assetId}` });
  const platforms = profile.publishing.cadence.map((c) => c.platform);
  await ctx.queue.enqueue("copy.generate", { productId, assetId, platforms: platforms.length ? [...new Set(platforms)] : ["instagram", "tiktok", "youtube", "x", "linkedin"] }, { productId, assetId, singletonKey: `copy.generate:${assetId}` });
  return { assetId, storageKey: result.finalKey, captionsBurned: result.captionsBurned, durationSec: outProbe.durationSec };
}
