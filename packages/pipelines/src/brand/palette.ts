import { assets, brandAssets, eq, inArray, products, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { inferPalette } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { PipelineError, type Palette } from "@distribution/core";

/**
 * brand.palette — sample brand colours from the uploaded logo/screenshots and
 * write them onto the product as an *inferred* palette. Never overwrites a
 * palette the founder provided or confirmed.
 */
export async function brandPalette(ctx: JobContext<"brand.palette">): Promise<Record<string, unknown>> {
  const { productId, assetIds } = ctx.payload;
  const storage = getStorage();

  await ctx.progress(5, "load", "loading brand assets");
  const rows = await ctx.db
    .select({ id: assets.id, key: assets.storageKey, mime: assets.mimeType, kind: brandAssets.kind })
    .from(assets)
    .leftJoin(brandAssets, eq(brandAssets.assetId, assets.id))
    .where(inArray(assets.id, assetIds));
  const images = rows.filter((r) => r.mime.startsWith("image/"));
  if (images.length === 0) throw new PipelineError("no image assets to sample", { retrySafe: false, step: "load" });

  const buffers = [];
  let i = 0;
  for (const r of images) {
    if (ctx.signal.aborted) throw new PipelineError("cancelled", { step: "load" });
    buffers.push({ buffer: await storage.getBuffer(r.key), role: (r.kind === "logo" ? "logo" : r.kind === "screenshot" ? "screenshot" : "other") as "logo" | "screenshot" | "other" });
    i++;
    await ctx.progress(5 + Math.round((i / images.length) * 45), "load", `read ${i}/${images.length} images`);
  }

  await ctx.progress(55, "sample", "clustering pixels");
  const result = await inferPalette(buffers);

  const product = (await ctx.db.select({ brand: products.brand }).from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) throw new PipelineError("product not found", { step: "save" });
  const brand = product.brand as { palette?: Palette };
  const existing = brand.palette;
  if (existing && existing.source !== "inferred") {
    await ctx.event("info", "palette already provided/confirmed; storing sample as suggestion only", { inferred: result });
    return { applied: false, palette: result };
  }
  const palette: Palette = {
    ink: result.ink,
    accent: result.accent,
    canvas: result.canvas,
    ground: result.ground,
    extra: result.extra,
    source: "inferred",
    inferredFrom: images.map((r) => r.id),
  };
  await ctx.progress(90, "save", "writing inferred palette");
  await ctx.db
    .update(products)
    .set({ brand: sql`jsonb_set(${products.brand}, '{palette}', ${JSON.stringify(palette)}::jsonb)`, updatedAt: sql`now()` })
    .where(eq(products.id, productId));
  await ctx.event("info", `palette inferred: accent ${palette.accent}, ink ${palette.ink}, canvas ${palette.canvas}, ground ${palette.ground}`, { clusters: result.clusters });
  return { applied: true, palette, clusters: result.clusters };
}
