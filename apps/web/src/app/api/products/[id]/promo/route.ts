import { profileAssets } from "@distribution/pipelines/profile-assets";
import { z } from "zod";
import { canonicalUrl, parseVideoId } from "@distribution/media";
import { getLlm, routesFor } from "@distribution/providers";
import { newId, PipelineError, ValidationError } from "@distribution/core";
import { SHOWREEL_PROMPT, SHOWREEL_SECONDS, resolveInspiration } from "@distribution/pipelines/promo-showreel";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { and, db, desc, eq, features, products, projects } from "@/lib/db";
import { getProduct, toProfile } from "@/lib/products";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Exactly three ways to make a promo film:
 *   inspirationUrl set                → the user's own YouTube inspiration
 *   useDefaultInspiration: true       → the default inspiration video
 *   neither (useDefaultInspiration false, the default) → no video; the showreel brief
 * Anything else is rejected rather than quietly becoming a fourth mode.
 * `useScreenshots: false` makes the film from the name, description and logo only.
 */
const Body = z
  .object({
    inspirationUrl: z.string().trim().max(500).optional().nullable(),
    useDefaultInspiration: z.boolean().default(false),
    useScreenshots: z.boolean().default(true),
  })
  .strict();

export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const body = Body.parse(await req.json().catch(() => ({})));

  let inspirationUrl = body.inspirationUrl?.trim() || null;
  if (inspirationUrl) {
    try {
      inspirationUrl = canonicalUrl(parseVideoId(inspirationUrl));
    } catch {
      throw new ValidationError("Use a YouTube video link for your inspiration video.");
    }
  }
  const inspiration = resolveInspiration({ inspirationUrl, useDefaultInspiration: body.useDefaultInspiration });

  // The director always runs; a reference adds the vision pass. Both use OpenRouter.
  const configured = getLlm().configuredProviders();
  const purposes = inspiration.mode === "none" ? ["promo_direction"] : ["promo_vision", "promo_direction"];
  if (purposes.some((purpose) => !routesFor(purpose).some((route) => configured.includes(route.provider)))) {
    throw new ValidationError("Promo generation is not configured on this installation (OPENROUTER_API_KEY is missing).");
  }

  const projectId = newId();
  const queue = await getQueue();
  const res = await db.transaction(async (tx) => {
    const row = (await tx.select().from(products).where(eq(products.id, productId)).for("share"))[0]!;
    const profileSnapshot = toProfile(row, await tx.select().from(features).where(eq(features.productId, productId)));
    try {
      const selected = await profileAssets(tx, profileSnapshot);
      if (!selected.logo) throw new ValidationError("Add a logo before generating a promo film.");
      if (body.useScreenshots && selected.screenshots.length === 0) throw new ValidationError("Add at least one screenshot before generating a promo film.");
    } catch (error) {
      if (error instanceof PipelineError) throw new ValidationError(error.message);
      throw error;
    }
    await tx.insert(projects).values({
      id: projectId,
      productId,
      kind: "promo",
      profileVersion: profileSnapshot.version,
      status: "running",
      params: {
        profileSnapshot,
        durationSec: SHOWREEL_SECONDS,
        inspiration,
        director: "openrouter",
        ...(inspiration.mode === "none" ? { creativePrompt: SHOWREEL_PROMPT } : {}),
        ...(body.useScreenshots ? {} : { useScreenshots: false }),
      },
    });
    return queue.enqueueInTransaction(tx, "promo.run", { productId, projectId, durationSec: SHOWREEL_SECONDS }, { productId, projectId, singletonKey: `promo.run:${projectId}` });
  });
  return json({ projectId, mode: inspiration.mode, inspirationUrl: inspiration.url, useScreenshots: body.useScreenshots, ...res }, { status: 202 });
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
