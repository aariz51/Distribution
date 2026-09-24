import { newId, slugify, ValidationError, ProductProfile, ProductProfileInput, type Palette } from "@distribution/core";
import { and, assets, brandAssets, db, desc, eq, features, inArray, products, productVersions, sourceVideos, sql } from "./db";
import { NotFound } from "./api";
import { requestId, requestHash } from "./request-key";
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

async function normalizeSources(input: ProductProfileInput["sources"]) {
  const { canonicalChannel } = await import("@distribution/media");
  const connected = input.connected.map(source => source.kind === "youtube_channel" ? { ...source, url: canonicalChannel(source.url) } : source);
  return { ...input, connected: [...new Map(connected.map(source => [`${source.kind}:${source.url}`, source])).values()] };
}

export async function createProduct(accountId: string, input: ProductProfileInput, sourceInputs: { url: string; rights: "owned" | "licensed" }[] = [], operationKey?: string): Promise<ProductProfile> {
  const { canonicalUrl, parseVideoId } = await import("@distribution/media");
  const initialSources = [...new Map(sourceInputs.map(source => { const videoId = parseVideoId(source.url); return [String(videoId), { id: newId(), url: canonicalUrl(videoId), externalId: String(videoId), rights: source.rights }]; })).values()];
  const sources = { ...await normalizeSources(input.sources), longFormSourceIds: [...input.sources.longFormSourceIds, ...initialSources.map(source => source.id)] };
  const id = operationKey ? requestId(`product:${accountId}`, operationKey) : newId();
  const inputHash = requestHash({ input, sourceInputs });
  const { features: feats, ...productNoFeatures } = input.product;
  const baseSlug = slugify(input.product.name);
  await db.transaction(async (tx) => {
    // Serialize creations for this account so both request replay and slug allocation are atomic.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`product-create:${accountId}`}, 0))`);
    const existing = (await tx.select().from(products).where(and(eq(products.id, id), eq(products.accountId, accountId))))[0];
    if (existing) {
      const initial = (await tx.select().from(productVersions).where(and(eq(productVersions.productId, id), eq(productVersions.version, 1))))[0];
      if (initial?.snapshot.intakeRequestHash !== inputHash) throw new ValidationError("This setup request was already used with different product details");
      return;
    }
    const taken = await tx.select({ slug: products.slug }).from(products).where(and(eq(products.accountId, accountId), sql`${products.slug} like ${baseSlug + "%"}`));
    const used = new Set(taken.map(row => row.slug));
    let slug = baseSlug;
    for (let suffix = 2; used.has(slug); suffix++) slug = `${baseSlug}-${suffix}`;
    await tx.insert(products).values({
      id,
      accountId,
      slug,
      version: 1,
      product: productNoFeatures,
      brand: input.brand,
      sources,
      publishing: input.publishing,
      contentPreferences: input.contentPreferences,
    });
    for (const f of feats) {
      await tx.insert(features).values({ id: f.id ?? newId(), productId: id, title: f.title, detail: f.detail ?? null, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds ?? [] });
    }
    for (const source of initialSources) await tx.insert(sourceVideos).values({ ...source, productId: id, kind: "youtube", platform: "youtube", status: "discovered" });
    await tx.insert(productVersions).values({ id: newId(), productId: id, version: 1, snapshot: { ...input, sources, intakeRequestHash: inputHash } as Record<string, unknown> });
  });
  return getProduct(accountId, id);
}

/** Full-profile update; bumps the version and snapshots it (Gate 2 §8). */
export async function updateProduct(accountId: string, id: string, input: ProductProfileInput, expectedVersion?: number, expectedUpdatedAt?: string): Promise<ProductProfile> {
  await getProduct(accountId, id);
  const sources = await normalizeSources(input.sources);
  const { features: feats, ...productNoFeatures } = input.product;
  await db.transaction(async (tx) => {
    const current = (await tx.select().from(products).where(and(eq(products.id, id), eq(products.accountId, accountId))).for("update"))[0];
    if (!current) throw new NotFound("product");
    if ((expectedVersion !== undefined && current.version !== expectedVersion) || (expectedUpdatedAt !== undefined && current.updatedAt.toISOString() !== expectedUpdatedAt)) throw new ValidationError("This product changed in another session. Reload before saving.");
    const version = current.version + 1;
    await tx
      .update(products)
      .set({ version, product: productNoFeatures, brand: input.brand, sources, publishing: input.publishing, contentPreferences: input.contentPreferences, updatedAt: sql`now()` })
      .where(eq(products.id, id));
    await tx.delete(features).where(eq(features.productId, id));
    for (const f of feats) {
      await tx.insert(features).values({ id: f.id ?? newId(), productId: id, title: f.title, detail: f.detail ?? null, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds ?? [] });
    }
    await tx.insert(productVersions).values({ id: newId(), productId: id, version, snapshot: { ...input, sources } as Record<string, unknown> });
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
