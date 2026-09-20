import path from "node:path";
import { readdir } from "node:fs/promises";
import { PipelineError, newId } from "@distribution/core";
import { assets, brandAssets, eq, sql, transcripts, candidates } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { bin, run, probeMedia } from "@distribution/media";
import { getLlm } from "@distribution/providers";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, paletteOf, withScratch, transcriptTextBetween } from "./common";
import { pickFrame, runCreative } from "./sidecars";
import { CREATIVE_COPY_SYSTEM, CREATIVE_COPY_USER, creativeBrandContext, fillPrompt, parseCopy } from "./ranking";

const LAYOUTS = ["bottom-anchor", "top-banner", "dark-editorial", "split"] as const;

/** shorts.thumbnail — the AutoShorts "post creative": sample frames, pick the cleanest, headline from the LLM, compose with brand palette + logo via creative.py. */
export async function shortsThumbnail(ctx: JobContext<"shorts.thumbnail">) {
  const { productId, projectId, assetId } = ctx.payload;
  const db = ctx.db;
  const storage = getStorage();
  const asset = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) throw new PipelineError("asset not found", { step: "load" });
  const profile = await loadProfile(db, productId);
  const palette = paletteOf(profile);
  const local = await storage.localPathFor(asset.storageKey);
  const probe = await probeMedia(local, { signal: ctx.signal });
  const meta = asset.metadata as { hook?: string; startSec?: number; endSec?: number; rank?: number };
  const logoRow = profile.brand.logoAssetId ? (await db.select({ key: assets.storageKey }).from(assets).where(eq(assets.id, profile.brand.logoAssetId)).limit(1))[0] : undefined;
  const logoPath = logoRow ? await storage.localPathFor(logoRow.key) : undefined;
  const screenshot = (await db.select({ key: assets.storageKey }).from(brandAssets).innerJoin(assets, eq(assets.id, brandAssets.assetId)).where(sql`${brandAssets.productId} = ${productId} and ${brandAssets.kind} = 'screenshot'`).orderBy(brandAssets.position).limit(1))[0];

  const out = await withScratch("thumb", async (scratch) => {
    await ctx.progress(10, "frames", "sampling frames");
    const framesDir = path.join(scratch, "frames");
    await run("mkdir", ["-p", framesDir], { step: "frames" });
    const step = Math.max(0.5, (probe.durationSec * 0.84) / 16);
    await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", (probe.durationSec * 0.08).toFixed(3), "-t", (probe.durationSec * 0.84).toFixed(3), "-i", local, "-vf", `fps=1/${step.toFixed(3)}`, "-q:v", "2", path.join(framesDir, "frame_%03d.jpg")], { timeoutMs: 10 * 60_000, signal: ctx.signal, step: "frames" });
    const frames = (await readdir(framesDir)).filter((f) => f.endsWith(".jpg")).sort().map((f) => path.join(framesDir, f));
    if (!frames.length) throw new PipelineError("no frames sampled", { step: "frames" });
    await ctx.progress(35, "pick", `scoring ${frames.length} frames`);
    const best = (await pickFrame(frames, { signal: ctx.signal })) ?? { path: frames[Math.floor(frames.length / 2)]!, score: 0, textiness: 0 };

    await ctx.progress(50, "copy", "writing headline");
    let headline = (meta.hook ?? profile.product.tagline).slice(0, 60);
    let kicker: string | null = profile.product.name.toUpperCase();
    try {
      let clipText = meta.hook ?? "";
      if (asset.candidateId) {
        const c = (await db.select().from(candidates).where(eq(candidates.id, asset.candidateId)).limit(1))[0];
        const t = c ? (await db.select().from(transcripts).where(eq(transcripts.id, c.transcriptId)).limit(1))[0] : undefined;
        if (t && c) clipText = transcriptTextBetween({ segments: t.segments }, c.startSec, c.endSec).slice(0, 1200);
      }
      const res = await getLlm().chat(
        { system: CREATIVE_COPY_SYSTEM, messages: [{ role: "user", content: fillPrompt(CREATIVE_COPY_USER, { brand_context: creativeBrandContext(profile.product.name, profile.product.tagline), hook: meta.hook ?? "", clip_text: clipText }) }], maxTokens: 300, temperature: 0.5, json: true },
        { purpose: "creative_copy", signal: ctx.signal, log: ctx.log, recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "chat", purpose: "creative_copy", inputTokens: u.inputTokens, outputTokens: u.outputTokens, usdEstimate: u.usdEstimate }) },
      );
      const c = parseCopy(res.text);
      headline = c.headline;
      kicker = c.kicker ?? kicker;
    } catch (err) {
      await ctx.event("warn", `creative copy failed, using hook: ${err instanceof Error ? err.message : err}`, undefined, "copy");
    }

    await ctx.progress(70, "compose", "composing thumbnail");
    const layout = LAYOUTS[((meta.rank ?? 1) - 1) % LAYOUTS.length]!;
    const pngPath = await runCreative(
      {
        frame: best.path,
        headline,
        kicker: kicker ?? undefined,
        attribution: undefined,
        brand: { name: profile.product.name, colorInk: palette.ink, colorAccent: palette.accent, colorCanvas: palette.canvas, colorGround: palette.ground, logoPath, ctaText: profile.brand.cta, fontDisplay: profile.brand.typography?.display, fontBody: profile.brand.typography?.body, fontHeavy: profile.brand.typography?.heavy },
        layout,
        size: [1080, 1350],
        screenshot: layout === "split" && screenshot ? await storage.localPathFor(screenshot.key) : undefined,
        out: path.join(scratch, "thumb.png"),
      },
      { signal: ctx.signal, onLog: (l) => void ctx.event("debug", l, undefined, "compose") },
    );
    const thumbId = newId();
    const key = keys.thumbnail(projectId, thumbId);
    await storage.putFile(key, pngPath, { contentType: "image/png" });
    await db.insert(assets).values({ id: thumbId, productId, projectId, type: "thumbnail", sourceId: asset.sourceId, candidateId: asset.candidateId, derivedFromAssetId: assetId, storageKey: key, mimeType: "image/png", width: 1080, height: 1350, status: "review", approvalState: "pending", profileVersion: profile.version, jobId: ctx.jobId, metadata: { headline, kicker, layout, frame: path.basename(best.path), textiness: best.textiness } });
    await db.update(assets).set({ thumbnailAssetId: thumbId, updatedAt: sql`now()` }).where(eq(assets.id, assetId));
    return { thumbId, headline, layout };
  });
  await ctx.progress(100, "done", "thumbnail ready");
  return out;
}
