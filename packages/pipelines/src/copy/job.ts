import { PipelineError, newId } from "@distribution/core";
import { assetCopy, assets, candidates, eq, sql, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { loadProfile, transcriptTextBetween } from "../shorts/common";
import { generatePlatformCopy } from "./platform-copy";

/** copy.generate — per-platform hook/title/caption/description/hashtags/CTA grounded in the transcript + profile. */
export async function copyGenerate(ctx: JobContext<"copy.generate">) {
  const { productId, assetId, platforms } = ctx.payload;
  const db = ctx.db;
  const asset = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!asset) throw new PipelineError("asset not found", { step: "load" });
  const profile = await loadProfile(db, productId);
  const meta = asset.metadata as { hook?: string; title?: string };
  let excerpt = meta.title ?? meta.hook ?? profile.product.tagline;
  if (asset.candidateId) {
    const c = (await db.select().from(candidates).where(eq(candidates.id, asset.candidateId)).limit(1))[0];
    const t = c ? (await db.select().from(transcripts).where(eq(transcripts.id, c.transcriptId)).limit(1))[0] : undefined;
    if (t && c) excerpt = transcriptTextBetween({ segments: t.segments }, c.startSec, c.endSec) || excerpt;
  }
  await ctx.progress(20, "copy", `writing copy for ${platforms.join(", ")}`);
  const result = await generatePlatformCopy(
    { profile, platforms, transcriptExcerpt: excerpt, hook: meta.hook, assetKind: asset.type.startsWith("promo") ? "promo" : "clip", durationSec: asset.durationSec ?? undefined, attribution: asset.metadata && (asset.metadata as { attribution?: string }).attribution },
    { purpose: "copy", signal: ctx.signal, log: ctx.log, recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "chat", purpose: "copy", inputTokens: u.inputTokens, outputTokens: u.outputTokens, usdEstimate: u.usdEstimate }) },
  );
  await ctx.progress(85, "save", "saving copy versions");
  for (const [platform, c] of Object.entries(result)) {
    const prev = await db.select({ v: sql<number>`coalesce(max(${assetCopy.version}), 0)` }).from(assetCopy).where(sql`${assetCopy.assetId} = ${assetId} and ${assetCopy.platform} = ${platform}`);
    await db.insert(assetCopy).values({ id: newId(), assetId, platform, hook: c.hook, title: c.title, caption: c.caption, description: c.description, hashtags: c.hashtags, cta: c.cta, version: Number(prev[0]?.v ?? 0) + 1, generatedBy: { purpose: "copy", jobId: ctx.jobId } });
  }
  await ctx.progress(100, "done", `${Object.keys(result).length} platforms`);
  return { platforms: Object.keys(result) };
}
