import { renderBrandedThumbnail } from "../thumbnail-render";
import { saveGeneratedAsset } from "../generated-assets";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { PipelineError, newId } from "@distribution/core";
import { assets, eq, projects, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { GB, assertDecodableVideo, assertDiskSpace, bin, probeMedia, run } from "@distribution/media";
import { renderPromo, type CompositionId } from "@distribution/promo-kit";
import type { Storyboard, Theme } from "@distribution/promo-kit/schema";
import { getStorage, keys } from "@distribution/storage";
import type { Inspiration } from "./showreel";
import { loadProfile, withScratch } from "../shorts/common";

const DELIVERABLES: { id: CompositionId; type: "promo_vertical" | "promo_landscape" | "promo_store_portrait" | "promo_store_landscape"; w: number; h: number }[] = [
  { id: "PromoVertical", type: "promo_vertical", w: 1080, h: 1920 },
  { id: "PromoLandscape", type: "promo_landscape", w: 1920, h: 1080 },
  { id: "PromoStorePortrait", type: "promo_store_portrait", w: 886, h: 1920 },
  { id: "PromoStoreLandscape", type: "promo_store_landscape", w: 1920, h: 886 },
];

export interface PromoParams {
  directedStructure?: unknown;
  referenceAnalysis?: unknown;
  referenceTitle?: string;
  directionProvider?: string;
  storyboard?: Storyboard;
  theme?: Theme;
  publicDir?: string;
  durationSec?: number;
  /** Opt-in: use the reference-analysis + LLM storyboard path (costs provider credits). */
  useLlm?: boolean;
  referenceUrl?: string;
  referenceAnalysisProvenance?: unknown;
  referenceAnalysisCached?: boolean;
  structureId?: string;
  notes?: string[];
  /** which of the three inspiration modes this film uses (set by the API) */
  inspiration?: Inspiration;
  /** who directs: Opus over OpenRouter (default) or a plan written in a Claude Code session */
  director?: "openrouter" | "claude-code";
  directorLabel?: string;
  /** The none-mode brief for this film; absent means SHOWREEL_PROMPT. */
  creativePrompt?: string;
  /** false: the film is made from the name, description and logo only */
  useScreenshots?: boolean;
  plan?: unknown;
  referenceBreakdown?: unknown;
  referenceProvenance?: Record<string, unknown>;
}

export async function projectParams(ctx: { db: JobContext<"promo.run">["db"] }, projectId: string): Promise<PromoParams> {
  const row = (await ctx.db.select({ params: projects.params }).from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!row) throw new PipelineError("promo project not found", { step: "load" });
  return (row.params ?? {}) as PromoParams;
}

export async function mergeParams(db: JobContext<"promo.run">["db"], projectId: string, patch: PromoParams): Promise<void> {
  await db
    .update(projects)
    .set({ params: sql`coalesce(${projects.params}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`now()` })
    .where(eq(projects.id, projectId));
}

/** promo.build — mix the sound master against the storyboard's cues, then fan out the renders. */
export async function promoBuild(ctx: JobContext<"promo.build">) {
  const { productId, projectId } = ctx.payload;
  const db = ctx.db;
  const params = await projectParams({ db }, projectId);
  if (!params.storyboard || !params.publicDir) throw new PipelineError("promo.build ran before a storyboard existed", { retrySafe: false, step: "load" });
  const sb = params.storyboard;

  await ctx.progress(10, "audio", `mixing ${sb.sfx.length} sound cues`);
  // The skill's latest build_audio.py, copied into the project at staging: it
  // reads sound.json, mixes the bundled effects with no music and no bed.
  const projectDir = path.dirname(params.publicDir);
  const soundPath = path.join(projectDir, "sound.json");
  await writeFile(soundPath, JSON.stringify({ duration: sb.durationFrames / sb.fps, cues: sb.sfx.map((c) => ({ fx: c.effect, at: +c.t.toFixed(3), vol: c.vol })) }, null, 1));
  const masterPath = path.join(params.publicDir, "audio", "master.wav");
  await run(bin("python"), [path.join(projectDir, "scripts", "build_audio.py"), "--timeline", soundPath, "--duration", String(sb.durationFrames / sb.fps), "--no-vo"], {
    timeoutMs: 15 * 60_000,
    signal: ctx.signal,
    step: "audio",
  });
  const audioProbe = await probeMedia(masterPath, { signal: ctx.signal });
  if (!audioProbe.hasAudio || Math.abs(audioProbe.durationSec - sb.durationFrames / sb.fps) > 0.1) {
    throw new PipelineError("sound master is missing audio or has the wrong duration", { step: "audio", retrySafe: false });
  }
  const audioSrc = "audio/master.wav";

  const withAudio: Storyboard = { ...sb, audioSrc };
  await mergeParams(db, projectId, { storyboard: withAudio });
  await getStorage().putBuffer(keys.promo(projectId, "storyboard.json"), Buffer.from(JSON.stringify({ storyboard: withAudio, theme: params.theme }, null, 2)), { contentType: "application/json" });
  await ctx.progress(60, "queue", "queueing four renders");
  for (const d of DELIVERABLES) {
    await ctx.queue.enqueue("promo.render", { productId, projectId, composition: d.id }, { productId, projectId, singletonKey: `promo.render:${projectId}:${d.id}`, priority: d.id === "PromoVertical" ? 5 : 0 });
  }
  await ctx.progress(100, "done", `audio ${audioSrc ? "mixed" : "skipped"}, 4 renders queued`);
  return { audioSrc, renders: DELIVERABLES.length };
}

/** promo.render — one composition to an MP4, stored as a reviewable asset with a poster. */
export async function promoRender(ctx: JobContext<"promo.render">) {
  const { productId, projectId, composition } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const params = await projectParams({ db }, projectId);
  if (!params.storyboard || !params.publicDir || !params.theme) throw new PipelineError("promo.render ran before the storyboard was built", { retrySafe: false, step: "load" });
  const deliverable = DELIVERABLES.find((d) => d.id === composition);
  if (!deliverable) throw new PipelineError(`unknown composition ${composition}`, { retrySafe: false });

  return withScratch("promo-render", async scratch => {
    const outKey = keys.promo(projectId, `out/${deliverable.type}.mp4`);
    const outPath = path.join(scratch, "render.mp4");

    // A 24s 1080p render plus Chromium's scratch runs to roughly 1.5 GB. Check
    // before starting: a render that runs out of disk mid-way does not error, it
    // simply stops advancing, which is indistinguishable from a slow machine.
    const space = await assertDiskSpace(path.dirname(outPath), 2 * GB, "render");
    await ctx.event("info", `disk: ${(space.freeBytes / GB).toFixed(1)} GB free`, undefined, "render");
    await ctx.progress(2, "render", `rendering ${composition} (${deliverable.w}×${deliverable.h})`);
    const res = await renderPromo({
      storyboard: { ...params.storyboard!, width: deliverable.w, height: deliverable.h },
      theme: params.theme!,
      compositionId: composition,
      outPath,
      publicDir: params.publicDir!,
      signal: ctx.signal,
      onProgress: (pct, done, total) => void ctx.progress(2 + Math.round(pct * 0.9), "render", `${composition}: frame ${done}/${total}`),
      stallTimeoutMs: Number(process.env.RENDER_STALL_TIMEOUT_MS ?? 4 * 60_000),
  });

  await ctx.progress(94, "poster", "grabbing a poster frame");
  const posterKey = keys.promo(projectId, `out/${deliverable.type}.png`);
  const posterFramePath = path.join(scratch, "poster-frame.png");
  const posterPath = path.join(scratch, "poster.png");
  // A poster should be the film's best-held frame, not whatever 25% lands on.
  // The longest scene is the one the director gave the most room, so sample its
  // middle; that is the money shot in every structure the director can choose.
  const longest = [...params.storyboard!.scenes].sort((a, b) => b.duration - a.duration)[0];
  const posterAt = longest ? (longest.start + longest.duration / 2) / res.fps : (res.durationInFrames / res.fps) * 0.25;
  await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", posterAt.toFixed(3), "-i", outPath, "-frames:v", "1", posterFramePath], { timeoutMs: 120_000, signal: ctx.signal, step: "poster" });
  const posterProfile = await loadProfile(db, productId, projectId);
  await renderBrandedThumbnail({ db, profile: posterProfile, frame: posterFramePath, headline: posterProfile.product.tagline, size: [deliverable.w, deliverable.h], out: posterPath, signal: ctx.signal });
  const probe = await probeMedia(outPath, { signal: ctx.signal });
  if (!probe.hasVideo || !probe.hasAudio || probe.width !== deliverable.w || probe.height !== deliverable.h || Math.abs(probe.durationSec - params.storyboard!.durationFrames / params.storyboard!.fps) > 0.2) {
    throw new PipelineError("promo output failed media validation", { step: "validate", retrySafe: false });
  }
  await assertDecodableVideo(outPath, probe.durationSec, ctx.signal);
  await storage.putFile(outKey, outPath, { contentType: "video/mp4" });
  await storage.putFile(posterKey, posterPath, { contentType: "image/png" });

  let posterId = newId();
  posterId = await saveGeneratedAsset(db, {
    id: posterId,
    productId,
    projectId,
    type: "thumbnail",
    storageKey: posterKey,
    mimeType: "image/png",
    width: deliverable.w,
    height: deliverable.h,
    status: "review",
    approvalState: "pending",
    profileVersion: (await loadProfile(db, productId, projectId)).version,
    jobId: ctx.jobId,
    metadata: { poster: true, composition, branded: true, headline: posterProfile.product.tagline },
  });
  let assetId = newId();
  assetId = await saveGeneratedAsset(db, {
    id: assetId,
    productId,
    projectId,
    type: deliverable.type,
    storageKey: outKey,
    mimeType: "video/mp4",
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec,
    sizeBytes: probe.sizeBytes,
    thumbnailAssetId: posterId,
    status: "review",
    approvalState: "pending",
    profileVersion: (await loadProfile(db, productId, projectId)).version,
    jobId: ctx.jobId,
    metadata: { composition, structure: params.structureId, fps: res.fps, frames: res.durationInFrames, audio: Boolean(params.storyboard!.audioSrc) },
  });

  // Every completed orientation triggers reconciliation. A per-render key keeps
  // a concurrent finalizer from consuming the last completion notification.
  await ctx.queue.enqueue("promo.finalize", { productId, projectId }, { productId, projectId, singletonKey: `promo.finalize:${projectId}:${composition}` });
  await ctx.progress(100, "done", `${deliverable.type} ready`);
  return { assetId, key: outKey, durationSec: probe.durationSec };
  });
}

/**
 * promo.finalize — App Store previews must be ≤30s at 30fps and exactly the
 * device size. Applies the skill's speed-up recipe when the film runs long.
 */
export async function promoFinalize(ctx: JobContext<"promo.finalize">) {
  const { productId, projectId } = ctx.payload;
  const storage = getStorage();
  const profile = await loadProfile(ctx.db, productId, projectId);
  return ctx.db.transaction(async (db) => {
    // Serialize this project's finalizers across worker processes. The lock is
    // released on success, failure, or connection loss, including worker crashes.
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
    const ready = await db.select({ type: assets.type }).from(assets).where(sql`${assets.projectId} = ${projectId} and (${assets.metadata}->>'appStoreCut') is null`);
    const missing = DELIVERABLES.filter(d => !ready.some(a => a.type === d.type));
    if (missing.length) {
      await ctx.progress(100, "waiting", `waiting for ${missing.map(d => d.type).join(", ")}`);
      return { cut: 0, waiting: missing.map(d => d.type) };
    }
    // Only uncut store renders, and only those that do not already have a cut
    // derived from them — two finalize jobs may overlap when both store renders
    // finish at once, and a duplicate 30s cut is worse than a slow one.
    const rows = await db
      .select()
      .from(assets)
      .where(sql`${assets.projectId} = ${projectId}
        and ${assets.type} in ('promo_store_portrait','promo_store_landscape')
        and (${assets.metadata}->>'appStoreCut') is null
        and not exists (select 1 from assets cut where cut.derived_from_asset_id = ${assets.id})`);
    if (rows.length === 0) {
      await db.update(projects).set({ status: "completed", updatedAt: sql`now()` }).where(eq(projects.id, projectId));
      await ctx.progress(100, "done", "all deliverables ready");
      return { cut: 0 };
    }

    let cut = 0;
    for (const [i, row] of rows.entries()) {
      await withScratch("store-preview", async scratch => {
        const src = await storage.localPathFor(row.storageKey);
        const probe = await probeMedia(src, { signal: ctx.signal });
        const outKey = keys.promo(projectId, `out/${row.type}-appstore.mp4`);
        const outPath = path.join(scratch, "preview.mp4");
        await ctx.progress(10 + Math.round((i / rows.length) * 80), "cut", `${row.type}: ${probe.durationSec.toFixed(1)}s → ≤30s at 30fps`);

        // A gentle global speed-up preserves the motion's feel; atempo keeps pitch.
        const speed = probe.durationSec > 29.5 ? probe.durationSec / 29.4 : 1;
        const filter = `[0:v]setpts=PTS/${speed.toFixed(6)},fps=30[v]` +
          (probe.hasAudio ? `;[0:a]atempo=${speed.toFixed(6)}[a]` : "");
        await run(
          bin("ffmpeg"),
          ["-v", "error", "-y", "-i", src, "-filter_complex", filter, "-map", "[v]", ...(probe.hasAudio ? ["-map", "[a]"] : []), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", outPath],
          { timeoutMs: 30 * 60_000, signal: ctx.signal, step: "cut" },
        );
        const outProbe = await probeMedia(outPath, { signal: ctx.signal });
        if (!outProbe.hasVideo || outProbe.fps !== 30 || outProbe.durationSec > 30 || outProbe.width !== probe.width || outProbe.height !== probe.height || (probe.hasAudio && !outProbe.hasAudio)) {
          throw new PipelineError("store preview failed media validation", { step: "validate", retrySafe: false });
        }
        await assertDecodableVideo(outPath, outProbe.durationSec, ctx.signal);
        await storage.putFile(outKey, outPath, { contentType: "video/mp4" });
        await saveGeneratedAsset(db, {
          id: newId(),
          productId,
          projectId,
          type: row.type,
          derivedFromAssetId: row.id,
          storageKey: outKey,
          mimeType: "video/mp4",
          width: outProbe.width,
          height: outProbe.height,
          durationSec: outProbe.durationSec,
          sizeBytes: outProbe.sizeBytes,
          thumbnailAssetId: row.thumbnailAssetId,
          status: "review",
          approvalState: "pending",
          profileVersion: profile.version,
          jobId: ctx.jobId,
          metadata: { appStoreCut: true, speed, sourceDurationSec: probe.durationSec, composition: (row.metadata as { composition?: string }).composition },
      });
      cut++;
      });
    }
    await db.update(projects).set({ status: "completed", updatedAt: sql`now()` }).where(eq(projects.id, projectId));
    await ctx.progress(100, "done", `${cut} App Store cut(s) ready`);
    return { cut };
  });
}

