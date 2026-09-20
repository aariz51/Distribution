import { newId, slugify, ProductProfile, ProductProfileInput, type Palette } from "@distribution/core";
import { and, assets, brandAssets, db, desc, eq, features, inArray, products, productVersions, sql } from "./db";
import { NotFound } from "./api";
import { getStorage } from "@distribution/storage";

type ProductRow = typeof products.$inferSelect;
type FeatureRow = typeof features.$inferSelect;

export function toProfile(row: ProductRow, featureRows: FeatureRow[]): ProductProfile {
  const productJson = row.product as Record<string, unknown>;
  return ProductProfile.parse({
    id: row.id,
    accountId: row.accountId,
    slug: row.slug,
    version: row.version,
    product: {
      ...productJson,
      features: featureRows
        .sort((a, b) => a.priority - b.priority)
        .map((f) => ({ id: f.id, title: f.title, detail: f.detail ?? undefined, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds })),
    },
    brand: row.brand,
    sources: row.sources,
    publishing: row.publishing,
    contentPreferences: row.contentPreferences,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function listProducts(accountId: string) {
  const rows = await db.select().from(products).where(eq(products.accountId, accountId)).orderBy(desc(products.updatedAt));
  const ids = rows.map((r) => r.id);
  const feats = ids.length ? await db.select().from(features).where(inArray(features.productId, ids)) : [];
  return rows.map((r) => toProfile(r, feats.filter((f) => f.productId === r.id)));
}

export async function getProduct(accountId: string, id: string): Promise<ProductProfile> {
  const row = (await db.select().from(products).where(and(eq(products.id, id), eq(products.accountId, accountId))).limit(1))[0];
  if (!row) throw new NotFound("product");
  const feats = await db.select().from(features).where(eq(features.productId, id));
  return toProfile(row, feats);
}

export async function createProduct(accountId: string, input: ProductProfileInput): Promise<ProductProfile> {
  const id = newId();
  const { features: feats, ...productNoFeatures } = input.product;
  const baseSlug = slugify(input.product.name);
  const taken = await db.select({ slug: products.slug }).from(products).where(and(eq(products.accountId, accountId), sql`${products.slug} like ${baseSlug + "%"}`));
  const slug = taken.some((t) => t.slug === baseSlug) ? `${baseSlug}-${taken.length + 1}` : baseSlug;
  await db.transaction(async (tx) => {
    await tx.insert(products).values({
      id,
      accountId,
      slug,
      version: 1,
      product: productNoFeatures,
      brand: input.brand,
      sources: input.sources,
      publishing: input.publishing,
      contentPreferences: input.contentPreferences,
    });
    for (const f of feats) {
      await tx.insert(features).values({ id: f.id ?? newId(), productId: id, title: f.title, detail: f.detail ?? null, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds ?? [] });
    }
    await tx.insert(productVersions).values({ id: newId(), productId: id, version: 1, snapshot: input as Record<string, unknown> });
  });
  return getProduct(accountId, id);
}

/** Full-profile update; bumps the version and snapshots it (Gate 2 §8). */
export async function updateProduct(accountId: string, id: string, input: ProductProfileInput): Promise<ProductProfile> {
  const current = await getProduct(accountId, id);
  const { features: feats, ...productNoFeatures } = input.product;
  const version = current.version + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ version, product: productNoFeatures, brand: input.brand, sources: input.sources, publishing: input.publishing, contentPreferences: input.contentPreferences, updatedAt: sql`now()` })
      .where(eq(products.id, id));
    await tx.delete(features).where(eq(features.productId, id));
    for (const f of feats) {
      await tx.insert(features).values({ id: f.id ?? newId(), productId: id, title: f.title, detail: f.detail ?? null, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds ?? [] });
    }
    await tx.insert(productVersions).values({ id: newId(), productId: id, version, snapshot: input as Record<string, unknown> });
  });
  return getProduct(accountId, id);
}

export async function setPalette(accountId: string, id: string, palette: Palette): Promise<void> {
  await getProduct(accountId, id);
  await db
    .update(products)
    .set({ brand: sql`jsonb_set(${products.brand}, '{palette}', ${JSON.stringify(palette)}::jsonb)`, updatedAt: sql`now()` })
    .where(eq(products.id, id));
}

export interface BrandAssetView {
  id: string;
  kind: "logo" | "screenshot" | "other" | "font";
  url: string;
  width: number | null;
  height: number | null;
  position: number;
  mimeType: string;
}

export async function listBrandAssets(productId: string): Promise<BrandAssetView[]> {
  const storage = getStorage();
  const rows = await db
    .select({ id: assets.id, kind: brandAssets.kind, key: assets.storageKey, width: assets.width, height: assets.height, position: brandAssets.position, mimeType: assets.mimeType })
    .from(brandAssets)
    .innerJoin(assets, eq(assets.id, brandAssets.assetId))
    .where(eq(brandAssets.productId, productId))
    .orderBy(brandAssets.kind, brandAssets.position);
  return rows.map((r) => ({ id: r.id, kind: r.kind, url: storage.publicUrl(r.key), width: r.width, height: r.height, position: r.position, mimeType: r.mimeType }));
}
