import { PipelineError, type ProductProfile } from "@distribution/core";
import { and, assets, eq, inArray, type Db } from "@distribution/db";

/** Resolve only the immutable IDs selected by the run's saved profile. */
export async function profileAssets(db: Pick<Db, "select">, profile: ProductProfile) {
  const ids = [...new Set([profile.brand.logoAssetId, ...profile.brand.screenshotAssetIds].filter((id): id is string => Boolean(id)))];
  const rows = ids.length ? await db.select().from(assets).where(and(eq(assets.productId, profile.id), inArray(assets.id, ids))) : [];
  const resolve = (id: string) => {
    const row = rows.find(asset => asset.id === id);
    if (!row || !row.mimeType.startsWith("image/")) throw new PipelineError("A brand image saved with this run is missing or belongs to another product. Restore the image or start a new run.", { step: "assets" });
    return row;
  };
  return { logo: profile.brand.logoAssetId ? resolve(profile.brand.logoAssetId) : undefined, screenshots: profile.brand.screenshotAssetIds.map(resolve) };
}
