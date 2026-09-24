import { ReferenceAnalysis } from "@distribution/pipelines/reference-analysis";
import { profileAssets } from "@distribution/pipelines/profile-assets";
import { referenceChoices } from "@/lib/references";
import { z } from "zod";
import { canonicalUrl, parseVideoId } from "@distribution/media";
import { getLlm, routesFor } from "@distribution/providers";
import { newId, PipelineError, ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { and, assets, db, desc, eq, features, products, projects, referenceVideos, sql } from "@/lib/db";
import { getProduct, toProfile } from "@/lib/products";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  /** 15–90s; the director scales its beat weights to fill exactly this. */
  durationSec: z.number().int().min(15).max(90).default(24),
  /** Opt in to the reference-analysis path, which spends provider credits. */
  useLlm: z.boolean().default(false),
  referenceUrl: z.url().optional(),
  referenceAssetId: z.uuid().optional(),
  referenceId: z.uuid().optional(),
});

/**
 * Start a promo film run. The default path is deterministic and costs nothing:
 * the director derives the structure and every line of copy from the product
 * profile. A logo is required because the closing lockup cannot be faked.
 */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const body = Body.parse(await req.json().catch(() => ({})));

  if ([body.referenceUrl, body.referenceAssetId, body.referenceId].filter(Boolean).length > 1) throw new ValidationError("Choose one reference video.");
  if (body.referenceUrl) {
    try { body.referenceUrl = canonicalUrl(parseVideoId(body.referenceUrl)); }
    catch { throw new ValidationError("Use a YouTube video link for the reference."); }
  }
  let needsVision = Boolean(body.referenceUrl || body.referenceAssetId);
  if (body.referenceId) {
    const reference = (await db.select().from(referenceVideos).where(eq(referenceVideos.id, body.referenceId)).limit(1))[0];
    if (!reference) throw new ValidationError("The selected reference is no longer in the catalog. Choose another reference.");
    const cached = ReferenceAnalysis.safeParse(reference.analysis);
    needsVision = !(cached.success && reference.durationSec && cached.data.beats.every(beat => beat.atSec <= reference.durationSec!));
    try { canonicalUrl(parseVideoId(reference.url)); }
    catch { throw new ValidationError("The selected reference does not have a supported YouTube video URL."); }
  }
  if (body.referenceAssetId) {
    const reference = (await db.select().from(assets).where(and(eq(assets.id, body.referenceAssetId), eq(assets.productId, productId))).limit(1))[0];
    if (!reference?.mimeType.startsWith("video/")) throw new ValidationError("Choose a video from this product's library.");
  }
  if (body.useLlm || body.referenceUrl || body.referenceAssetId || body.referenceId) {
    const configured = getLlm().configuredProviders();
    const purposes = needsVision ? ["vision", "storyboard"] : ["storyboard"];
    if (purposes.some(purpose => !routesFor(purpose).some(route => configured.includes(route.provider)))) {
      throw new ValidationError("Configure the AI providers for video analysis and storyboards before using AI direction.");
    }
  }

  const projectId = newId();
  const queue = await getQueue();
  const res = await db.transaction(async tx => {
    const row = (await tx.select().from(products).where(eq(products.id, productId)).for("share"))[0]!;
    const profileSnapshot = toProfile(row, await tx.select().from(features).where(eq(features.productId, productId)));
    try {
      const selected = await profileAssets(tx, profileSnapshot);
      if (!selected.logo) throw new ValidationError("Select a logo before generating a promo film.");
    } catch (error) {
      if (error instanceof PipelineError) throw new ValidationError(error.message);
      throw error;
    }
    const alternatives = body.referenceId ? await referenceChoices(profileSnapshot, body.durationSec, tx) : [];
    await tx.insert(projects).values({
      id: projectId,
      productId,
      kind: "promo",
      referenceId: body.referenceId,
      profileVersion: profileSnapshot.version,
      status: "running",
      params: { ...(body.referenceId ? { referenceSelection: { selectedId: body.referenceId, alternatives } } : {}), profileSnapshot, durationSec: body.durationSec, useLlm: body.useLlm, ...(body.referenceUrl ? { referenceUrl: body.referenceUrl } : {}), ...(body.referenceAssetId ? { referenceAssetId: body.referenceAssetId } : {}), ...(body.referenceId ? { referenceId: body.referenceId } : {}) },
    });

    if (body.referenceId) await tx.update(referenceVideos).set({ usageCount: sql`${referenceVideos.usageCount} + 1`, lastUsedProductId: productId, updatedAt: sql`now()` }).where(eq(referenceVideos.id, body.referenceId));
    return queue.enqueueInTransaction(tx,
      "promo.run",
      { productId, projectId, durationSec: body.durationSec, ...(body.referenceUrl ? { referenceUrl: body.referenceUrl } : {}), ...(body.referenceAssetId ? { referenceAssetId: body.referenceAssetId } : {}), ...(body.referenceId ? { referenceId: body.referenceId } : {}) },
      { productId, projectId, singletonKey: `promo.run:${projectId}` },
    );
  });
  return json({ projectId, ...res }, { status: 202 });
});

/** Promo runs for this product, newest first, so the UI can show history. */
export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.productId, productId), eq(projects.kind, "promo")))
    .orderBy(desc(projects.createdAt))
    .limit(20);
  return json({ projects: rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, params: r.params })) });
});
