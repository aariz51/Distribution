import { loadProductProfile, type Db } from "@distribution/db";
import { PipelineError, type ProductProfile } from "@distribution/core";

export async function requireProfile(db: Db, productId: string): Promise<ProductProfile> {
  const p = await loadProductProfile(db, productId);
  if (!p) throw new PipelineError(`product ${productId} not found`, { retrySafe: false });
  return p;
}

/** Palette with safe defaults for renderers when the profile has none yet. */
export function paletteOf(p: ProductProfile) {
  return (
    p.brand.palette ?? { ink: "#14171a", accent: "#17b26a", canvas: "#f6f5f1", ground: "#0d1114", extra: [], source: "inferred" as const, inferredFrom: [] }
  );
}
