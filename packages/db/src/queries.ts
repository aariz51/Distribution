import { eq } from "drizzle-orm";
import { ProductProfile } from "@distribution/core";
import type { Db } from "./client";
import { features, products } from "./schema/index";

type ProductRow = typeof products.$inferSelect;
type FeatureRow = typeof features.$inferSelect;

/** Rows → validated ProductProfile (features live in their own table). */
export function toProductProfile(row: ProductRow, featureRows: FeatureRow[]): ProductProfile {
  const productJson = row.product as Record<string, unknown>;
  return ProductProfile.parse({
    id: row.id,
    accountId: row.accountId,
    slug: row.slug,
    version: row.version,
    product: {
      ...productJson,
      features: [...featureRows]
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

export async function loadProductProfile(db: Db, productId: string): Promise<ProductProfile | null> {
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) return null;
  const feats = await db.select().from(features).where(eq(features.productId, productId));
  return toProductProfile(row, feats);
}
