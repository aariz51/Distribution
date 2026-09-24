import { reconcileShortsProject } from "../shorts/completion";
import { PipelineError, newId } from "@distribution/core";
import { assetCopy, assets, candidates, eq, sql, transcripts, sourceVideos } from "@distribution/db";
import { sourceAttribution } from "../shorts/attribution";
import type { JobContext } from "@distribution/jobs";
import { loadProfile, transcriptTextBetween } from "../shorts/common";
import { captionLength } from "./caption";
import { generatePlatformCopy, PLATFORM_RULES } from "./platform-copy";

/** copy.generate — per-platform hook/title/caption/description/hashtags/CTA grounded in the transcript + profile. */
export async function copyGenerate(ctx: JobContext<"copy.generate">) {
  const { productId, assetId, platforms } = ctx.payload;
  const db = ctx.db;
  const asset = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) throw new PipelineError("asset not found", { step: "load" });
  const profile = await loadProfile(db, productId, asset.projectId);
  const saved = await db.select({ platform: assetCopy.platform }).from(assetCopy).where(sql`${assetCopy.assetId} = ${assetId} and ${assetCopy.generatedBy}->>'jobId' = ${ctx.jobId}`);
  const remainingPlatforms = platforms.filter(platform => !saved.some(row => row.platform === platform));
  if (!remainingPlatforms.length) {
    if (asset.projectId) await reconcileShortsProject(db, productId, asset.projectId);
    await ctx.progress(100, "done", "platform copy already saved");
    return { platforms, reused: true };
  }
  const meta = asset.metadata as { hook?: string; title?: string };
  const source = asset.sourceId ? (await db.select().from(sourceVideos).where(eq(sourceVideos.id, asset.sourceId)))[0] : undefined;
  const attribution = source ? sourceAttribution(source) : typeof asset.metadata.attribution === "string" ? asset.metadata.attribution : undefined;
  const blockedPlatforms = remainingPlatforms.filter(p => attribution && captionLength(attribution, p) > (PLATFORM_RULES[p]?.captionMax ?? 2200));
  const supportedPlatforms = remainingPlatforms.filter(p => !blockedPlatforms.includes(p));
  let excerpt = meta.title ?? meta.hook ?? profile.product.tagline;
  if (asset.candidateId) {
    const c = (await db.select().from(candidates).where(eq(candidates.id, asset.candidateId)).limit(1))[0];
    const t = c ? (await db.select().from(transcripts).where(eq(transcripts.id, c.transcriptId)).limit(1))[0] : undefined;
    if (t && c) excerpt = transcriptTextBetween({ segments: t.segments }, c.startSec, c.endSec) || excerpt;
  }
  await ctx.progress(20, "copy", `writing copy for ${platforms.join(", ")}`);
  const result = supportedPlatforms.length ? await generatePlatformCopy(
    { profile, platforms: supportedPlatforms, transcriptExcerpt: excerpt, hook: meta.hook, assetKind: asset.type.startsWith("promo") ? "promo" : "clip", durationSec: asset.durationSec ?? undefined, attribution },
    { purpose: "copy", signal: ctx.signal, log: ctx.log, recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "chat", purpose: "copy", inputTokens: u.inputTokens, outputTokens: u.outputTokens, usdEstimate: u.usdEstimate }) },
  ) : {};
  await ctx.progress(85, "save", "saving copy versions");
  for (const [platform, c] of Object.entries(result)) {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`copy:${assetId}:${platform}`}, 0))`);
      const alreadySaved = await tx.select({ id: assetCopy.id }).from(assetCopy).where(sql`${assetCopy.assetId} = ${assetId} and ${assetCopy.platform} = ${platform} and ${assetCopy.generatedBy}->>'jobId' = ${ctx.jobId}`).limit(1);
      if (alreadySaved.length) return;
    const prev = await tx.select({ v: sql<number>`coalesce(max(${assetCopy.version}), 0)` }).from(assetCopy).where(sql`${assetCopy.assetId} = ${assetId} and ${assetCopy.platform} = ${platform}`);
    await tx.insert(assetCopy).values({ id: newId(), assetId, platform, hook: c.hook, title: c.title, caption: c.caption, description: c.description, hashtags: c.hashtags, cta: c.cta, version: Number(prev[0]?.v ?? 0) + 1, generatedBy: { purpose: "copy", jobId: ctx.jobId } });
    });
  }
  if (blockedPlatforms.length) throw new PipelineError(`Copy saved for compatible platforms. Required source credit exceeds the caption limit for ${blockedPlatforms.join(", ")}. Choose platforms with longer caption limits.`, { step: "copy", retrySafe: false, details: { blockedPlatforms, savedPlatforms: [...saved.map(row => row.platform), ...Object.keys(result)] } });
  if (asset.projectId) await reconcileShortsProject(db, productId, asset.projectId);
  await ctx.progress(100, "done", `${Object.keys(result).length} platforms`);
  return { platforms: Object.keys(result) };
}
