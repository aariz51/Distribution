import sharp from "sharp";
import { z } from "zod";
import { newId, ValidationError } from "@distribution/core";
import { getStorage, keys } from "@distribution/storage";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { assets, brandAssets, db, eq, products, sql } from "@/lib/db";
import { getProduct, listBrandAssets } from "@/lib/products";

const Kind = z.enum(["logo", "screenshot", "other"]);
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(["png", "jpeg", "webp", "gif", "svg"]);

type Ctx = { params: Promise<{ id: string }> };

/** multipart/form-data: file (image), kind (logo|screenshot|other). */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  const product = await getProduct(s.accountId, productId);
  const form = await req.formData();
  const kind = Kind.parse(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("file missing");
  if (file.size > MAX_BYTES) throw new ValidationError("file too large", { max: MAX_BYTES });
  const buf = Buffer.from(await file.arrayBuffer());
  // Sniff the real format; never trust the extension or declared type.
  const meta = await sharp(buf).metadata().catch(() => null);
  if (!meta?.format || !ALLOWED.has(meta.format)) throw new ValidationError("unsupported image", { format: meta?.format });
  const ext = meta.format === "jpeg" ? "jpg" : meta.format;
  const assetId = newId();
  const key = keys.brandAsset(productId, assetId, ext);
  await getStorage().putBuffer(key, buf, { contentType: `image/${meta.format}` });

  const existing = await db.select({ n: sql<number>`count(*)` }).from(brandAssets).where(eq(brandAssets.productId, productId));
  await db.transaction(async (tx) => {
    await tx.insert(assets).values({
      id: assetId,
      productId,
      type: "creative_image",
      storageKey: key,
      mimeType: `image/${meta.format}`,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sizeBytes: buf.length,
      status: "approved",
      approvalState: "approved",
      profileVersion: product.version,
      metadata: { role: kind, originalName: file.name },
    });
    await tx.insert(brandAssets).values({ id: newId(), productId, kind, assetId, position: Number(existing[0]?.n ?? 0) });
    const brand = product.brand;
    const next = {
      ...brand,
      logoAssetId: kind === "logo" ? assetId : brand.logoAssetId,
      screenshotAssetIds: kind === "screenshot" ? [...brand.screenshotAssetIds, assetId] : brand.screenshotAssetIds,
      otherAssetIds: kind === "other" ? [...brand.otherAssetIds, assetId] : brand.otherAssetIds,
    };
    await tx.update(products).set({ brand: next, updatedAt: sql`now()` }).where(eq(products.id, productId));
  });
  return json({ assetId, brandAssets: await listBrandAssets(productId) }, { status: 201 });
});

export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await getProduct(s.accountId, id);
  return json({ brandAssets: await listBrandAssets(id) });
});
