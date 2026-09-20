import path from "node:path";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { PipelineError, newId } from "@distribution/core";
import { assets, brandAssets, eq, projects, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, probeMedia, run } from "@distribution/media";
import { renderPromo, type CompositionId } from "@distribution/promo-kit";
import type { Storyboard, Theme } from "@distribution/promo-kit/schema";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile } from "../shorts/common";
import { buildStoryboard } from "./storyboard-rules";
import { creativeDirectionMarkdown } from "./creative-direction";
import { themeForProduct } from "./theme";
import { STRUCTURES } from "./structures";

const KIT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../promo-kit");

const DELIVERABLES: { id: CompositionId; type: "promo_vertical" | "promo_landscape" | "promo_store_portrait" | "promo_store_landscape"; w: number; h: number }[] = [
  { id: "PromoVertical", type: "promo_vertical", w: 1080, h: 1920 },
  { id: "PromoLandscape", type: "promo_landscape", w: 1920, h: 1080 },
  { id: "PromoStorePortrait", type: "promo_store_portrait", w: 886, h: 1920 },
  { id: "PromoStoreLandscape", type: "promo_store_landscape", w: 1920, h: 886 },
];

interface PromoParams {
  storyboard?: Storyboard;
  theme?: Theme;
  publicDir?: string;
  durationSec?: number;
  /** Opt-in: use the reference-analysis + LLM storyboard path (costs provider credits). */
  useLlm?: boolean;
  referenceUrl?: string;
  structureId?: string;
  notes?: string[];
}

async function projectParams(ctx: { db: JobContext<"promo.run">["db"] }, projectId: string): Promise<PromoParams> {
  const row = (await ctx.db.select({ params: projects.params }).from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  if (!row) throw new PipelineError("promo project not found", { step: "load" });
  return (row.params ?? {}) as PromoParams;
}

async function mergeParams(db: JobContext<"promo.run">["db"], projectId: string, patch: PromoParams): Promise<void> {
  await db
    .update(projects)
    .set({ params: sql`coalesce(${projects.params}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`now()` })
    .where(eq(projects.id, projectId));
}

/**
 * promo.run — decide the film and write it down.
 *
 * The default path is deterministic: the structure and every line of copy come
 * from the product profile, so a promo costs nothing and cannot invent a claim.
 * `params.useLlm` opts into the reference-analysis path, which spends provider
 * credits and is therefore never the default.
 */
export async function promoRun(ctx: JobContext<"promo.run">) {
  const { productId, projectId } = ctx.payload;
  const db = ctx.db;
  const profile = await loadProfile(db, productId);
  const params = await projectParams({ db }, projectId);
  const storage = getStorage();

  if (params.useLlm || ctx.payload.referenceUrl || ctx.payload.referenceId) {
    await ctx.event("info", "reference-driven storyboard requested; handing off to promo.analyze_reference", undefined, "route");
    await ctx.queue.enqueue(
      "promo.analyze_reference",
      { productId, projectId, ...(ctx.payload.referenceUrl ? { referenceUrl: ctx.payload.referenceUrl } : {}), ...(ctx.payload.referenceId ? { referenceId: ctx.payload.referenceId } : {}) },
      { productId, projectId, singletonKey: `promo.analyze:${projectId}` },
    );
    await ctx.progress(100, "done", "queued reference analysis");
    return { path: "llm" };
  }

  await ctx.progress(10, "assets", "collecting brand assets");
  const brand = await db
    .select({ kind: brandAssets.kind, key: assets.storageKey, position: brandAssets.position, mime: assets.mimeType })
    .from(brandAssets)
    .innerJoin(assets, eq(assets.id, brandAssets.assetId))
    .where(eq(brandAssets.productId, productId))
    .orderBy(brandAssets.position);
  const logoRow = brand.find((b) => b.kind === "logo");
  const screenRows = brand.filter((b) => b.kind === "screenshot");
  if (!logoRow) throw new PipelineError("a logo is required for the promo film — upload one on the product page", { retrySafe: false, step: "assets" });

  // Stage assets into the project's own public/ dir: Remotion's staticFile root.
  const publicDir = path.join(path.dirname(await storage.localPathFor(keys.promo(projectId, "public/.keep"))), "");
  await mkdir(path.join(publicDir, "app-screens"), { recursive: true });
  await mkdir(path.join(publicDir, "logo"), { recursive: true });
  await mkdir(path.join(publicDir, "audio"), { recursive: true });
  await copyFile(await storage.localPathFor(logoRow.key), path.join(publicDir, "logo", "app-logo.png"));
  const screens: Record<string, string> = {};
  for (const [i, s] of screenRows.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-screen.png`;
    await copyFile(await storage.localPathFor(s.key), path.join(publicDir, "app-screens", name));
    screens[`screen${i + 1}`] = `app-screens/${name}`;
  }
  // Fonts and sound effects ship with the kit.
  for (const dir of ["fonts", "sfx"]) {
    await run("cp", ["-R", path.join(KIT_ROOT, "public", dir), publicDir], { step: "assets", timeoutMs: 60_000 }).catch(() => undefined);
  }

  await ctx.progress(45, "direct", "choosing a structure and writing the storyboard");
  const built = buildStoryboard({
    profile,
    screens,
    logo: "logo/app-logo.png",
    durationSec: params.durationSec ?? 33,
    audioSrc: null,
  });
  const theme = themeForProduct(profile);

  const md = creativeDirectionMarkdown({ profile, storyboard: built.storyboard, structure: built.structure, notes: built.notes, reference: null });
  const mdKey = keys.promo(projectId, "CREATIVE_DIRECTION.md");
  await storage.putBuffer(mdKey, Buffer.from(md), { contentType: "text/markdown" });
  const sbKey = keys.promo(projectId, "storyboard.json");
  await storage.putBuffer(sbKey, Buffer.from(JSON.stringify({ storyboard: built.storyboard, theme }, null, 2)), { contentType: "application/json" });

  for (const [type, key, mime] of [
    ["creative_direction_md", mdKey, "text/markdown"],
    ["storyboard", sbKey, "application/json"],
  ] as const) {
    await db.insert(assets).values({
      id: newId(),
      productId,
      projectId,
      type,
      storageKey: key,
      mimeType: mime,
      status: "review",
      approvalState: "pending",
      profileVersion: profile.version,
      jobId: ctx.jobId,
      metadata: { structure: built.structure.id, scenes: built.storyboard.scenes.length },
    });
  }

  await mergeParams(db, projectId, { storyboard: built.storyboard, theme, publicDir, structureId: built.structure.id, notes: built.notes });
  await ctx.event("info", `structure "${built.structure.id}": ${built.storyboard.scenes.map((s) => s.kind).join(" → ")}`, undefined, "direct");
  await ctx.queue.enqueue("promo.build", { productId, projectId }, { productId, projectId, singletonKey: `promo.build:${projectId}` });
  await ctx.progress(100, "done", "storyboard written");
  return { structure: built.structure.id, scenes: built.storyboard.scenes.length, screens: Object.keys(screens).length };
}

/** promo.build — mix the sound master against the storyboard's cues, then fan out the renders. */
export async function promoBuild(ctx: JobContext<"promo.build">) {
  const { productId, projectId } = ctx.payload;
  const db = ctx.db;
  const params = await projectParams({ db }, projectId);
  if (!params.storyboard || !params.publicDir) throw new PipelineError("promo.build ran before a storyboard existed", { retrySafe: false, step: "load" });
  const sb = params.storyboard;

  await ctx.progress(10, "audio", `mixing ${sb.sfx.length} sound cues`);
  const fxPath = path.join(params.publicDir, "fx.json");
  await writeFile(fxPath, JSON.stringify(sb.sfx));
  const masterPath = path.join(params.publicDir, "audio", "master.wav");
  let audioSrc: string | null = null;
  try {
    await run(bin("python"), [path.join(KIT_ROOT, "scripts", "build_audio.py"), "--duration", String(sb.durationFrames / sb.fps), "--fx", fxPath, "--out", masterPath, "--sfx-dir", path.join(params.publicDir, "sfx")], {
      timeoutMs: 15 * 60_000,
      signal: ctx.signal,
      step: "audio",
    });
    audioSrc = "audio/master.wav";
  } catch (err) {
    // A silent film is a worse film, not a failed job.
    await ctx.event("warn", `sound design unavailable, rendering silent: ${err instanceof Error ? err.message : err}`, undefined, "audio");
  }

  const withAudio: Storyboard = { ...sb, audioSrc };
  await mergeParams(db, projectId, { storyboard: withAudio });
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

  const outKey = keys.promo(projectId, `out/${deliverable.type}.mp4`);
  const outPath = await storage.localPathFor(outKey);
  await ctx.progress(2, "render", `rendering ${composition} (${deliverable.w}×${deliverable.h})`);
  const res = await renderPromo({
    storyboard: { ...params.storyboard, width: deliverable.w, height: deliverable.h },
    theme: params.theme,
    compositionId: composition,
    outPath,
    publicDir: params.publicDir,
    signal: ctx.signal,
    onProgress: (pct, done, total) => void ctx.progress(2 + Math.round(pct * 0.9), "render", `${composition}: frame ${done}/${total}`),
  });

  await ctx.progress(94, "poster", "grabbing a poster frame");
  const posterKey = keys.promo(projectId, `out/${deliverable.type}.png`);
  const posterPath = await storage.localPathFor(posterKey);
  const posterAt = (res.durationInFrames / res.fps) * 0.25;
  await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", posterAt.toFixed(3), "-i", outPath, "-frames:v", "1", posterPath], { timeoutMs: 120_000, step: "poster" }).catch(() => undefined);
  const probe = await probeMedia(outPath, { signal: ctx.signal });

  const posterId = newId();
  await db.insert(assets).values({
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
    profileVersion: (await loadProfile(db, productId)).version,
    jobId: ctx.jobId,
    metadata: { poster: true, composition },
  });
  const assetId = newId();
  await db.insert(assets).values({
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
    profileVersion: (await loadProfile(db, productId)).version,
    jobId: ctx.jobId,
    metadata: { composition, structure: params.structureId, fps: res.fps, frames: res.durationInFrames, audio: Boolean(params.storyboard.audioSrc) },
  });

  if (composition === "PromoStorePortrait" || composition === "PromoStoreLandscape") {
    await ctx.queue.enqueue("promo.finalize", { productId, projectId }, { productId, projectId, singletonKey: `promo.finalize:${projectId}` });
  }
  await ctx.progress(100, "done", `${deliverable.type} ready`);
  return { assetId, key: outKey, durationSec: probe.durationSec };
}

/**
 * promo.finalize — App Store previews must be ≤30s at 30fps and exactly the
 * device size. Applies the skill's speed-up recipe when the film runs long.
 */
export async function promoFinalize(ctx: JobContext<"promo.finalize">) {
  const { productId, projectId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const profile = await loadProfile(db, productId);
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
    await ctx.progress(100, "done", "nothing to trim");
    return { cut: 0 };
  }

  let cut = 0;
  for (const [i, row] of rows.entries()) {
    const src = await storage.localPathFor(row.storageKey);
    const probe = await probeMedia(src, { signal: ctx.signal });
    const outKey = keys.promo(projectId, `out/${row.type}-appstore.mp4`);
    const outPath = await storage.localPathFor(outKey);
    await ctx.progress(10 + Math.round((i / rows.length) * 80), "cut", `${row.type}: ${probe.durationSec.toFixed(1)}s → ≤30s at 30fps`);

    // A gentle global speed-up preserves the motion's feel; atempo keeps pitch.
    const speed = probe.durationSec > 29.5 ? probe.durationSec / 29.4 : 1;
    const filter =
      speed > 1
        ? `[0:v]setpts=PTS/${speed.toFixed(6)},fps=30[v];[0:a]atempo=${speed.toFixed(6)}[a]`
        : `[0:v]fps=30[v];[0:a]anull[a]`;
    await run(
      bin("ffmpeg"),
      ["-v", "error", "-y", "-i", src, "-filter_complex", filter, "-map", "[v]", "-map", "[a]?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", outPath],
      { timeoutMs: 30 * 60_000, signal: ctx.signal, step: "cut" },
    );
    const outProbe = await probeMedia(outPath, { signal: ctx.signal });
    await db.insert(assets).values({
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
  }
  await db.update(projects).set({ status: "completed", updatedAt: sql`now()` }).where(eq(projects.id, projectId));
  await ctx.progress(100, "done", `${cut} App Store cut(s) ready`);
  return { cut };
}

export { STRUCTURES };
