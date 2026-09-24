import { createHash } from "node:crypto";
import { requestKey, requestId } from "@/lib/request-key";
import sharp from "sharp";
import { z } from "zod";
import { newId, ValidationError, BrandInfo } from "@distribution/core";
import { getStorage, keys } from "@distribution/storage";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { assets, brandAssets, db, eq, and, products, sql } from "@/lib/db";
import { getProduct, listBrandAssets } from "@/lib/products";

const Kind = z.enum(["logo", "screenshot", "other"]);
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(["png", "jpeg", "webp", "gif", "svg"]);

type Ctx = { params: Promise<{ id: string }> };

/** multipart/form-data: file (image), kind (logo|screenshot|other). */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
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
  const operationKey = requestKey(req);
  const assetId = operationKey ? requestId(`brand-asset:${productId}`, operationKey) : newId();
  const hash = createHash("sha256").update(buf).digest("hex");
  const key = keys.brandAsset(productId, assetId, ext);
  await db.transaction(async (tx) => {
    const current = (await tx.select().from(products).where(and(eq(products.id, productId), eq(products.accountId, s.accountId))).for("update"))[0];
    if (!current) throw new ValidationError("Product no longer exists");
    const replay = (await tx.select().from(assets).where(eq(assets.id, assetId)))[0];
    if (replay) {
      if (replay.productId !== productId || replay.metadata.uploadSha256 !== hash || replay.metadata.role !== kind) throw new ValidationError("This upload request was already used for a different asset");
      return;
    }
    await getStorage().putBuffer(key, buf, { contentType: `image/${meta.format}` });
    const existing = await tx.select({ n: sql<number>`count(*)` }).from(brandAssets).where(eq(brandAssets.productId, productId));
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
      profileVersion: current.version,
      metadata: { role: kind, originalName: file.name, uploadSha256: hash },
    });
    await tx.insert(brandAssets).values({ id: newId(), productId, kind, assetId, position: Number(existing[0]?.n ?? 0) });
    const brand = BrandInfo.parse(current.brand);
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
