import type { Db } from "@distribution/db";
import type { ProductProfile } from "@distribution/core";
import { getStorage } from "@distribution/storage";
import { profileAssets } from "./profile-assets";
import { paletteOf } from "./shorts/common";
import { runCreative } from "./shorts/sidecars";

export const THUMBNAIL_VARIANTS: { name: string; size: [number, number]; platforms: string[] }[] = [
  { name: "portrait", size: [1080, 1920], platforms: ["instagram", "tiktok"] },
  { name: "landscape", size: [1280, 720], platforms: ["youtube", "x", "linkedin"] },
  { name: "feed", size: [1080, 1350], platforms: ["instagram-feed"] },
];

/** Compose a real frame with the saved brand assets, not an arbitrary scene screenshot. */
export async function renderBrandedThumbnail(input: { db: Db; profile: ProductProfile; frame: string; headline: string; size: [number, number]; out: string; signal: AbortSignal }): Promise<string> {
  const { profile } = input;
  const brand = await profileAssets(input.db, profile), palette = paletteOf(profile);
  const logoPath = brand.logo ? await getStorage().localPathFor(brand.logo.storageKey) : undefined;
  return runCreative({ frame: input.frame, headline: input.headline, kicker: profile.product.name.toUpperCase(), layout: "bottom-anchor", size: input.size, out: input.out,
    brand: { name: profile.product.name, colorInk: palette.ink, colorAccent: palette.accent, colorCanvas: palette.canvas, colorGround: palette.ground, logoPath, ctaText: profile.brand.cta, fontDisplay: profile.brand.typography?.display, fontBody: profile.brand.typography?.body, fontHeavy: profile.brand.typography?.heavy },
  }, { signal: input.signal });
}
