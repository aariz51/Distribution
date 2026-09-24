import { PipelineError } from "@distribution/core";
import type { assets } from "@distribution/db";
type Asset = typeof assets.$inferSelect;
/** The landscape variant is deterministic; a different approved cover cannot bypass its review. */
export function youtubeCover(asset: Asset, candidates: Asset[]): Asset {
  const parentId = asset.type === "clip_enriched" ? asset.derivedFromAssetId : asset.id;
  const owned = candidates.filter(t => t.productId === asset.productId && t.type === "thumbnail");
  const cover = owned.find(t => t.derivedFromAssetId === parentId && t.metadata.variant === "landscape") ?? owned.find(t => t.id === asset.thumbnailAssetId);
  if (!cover || cover.status !== "approved" || cover.approvalState !== "approved") throw new PipelineError("Approve the video's YouTube cover in the library before scheduling or publishing.", { step: "publish", retrySafe: false });
  return cover;
}
