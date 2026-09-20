import { z } from "zod";

/** Content-library asset lifecycle (Gate 2 §7). `archived` is terminal and also
 *  holds rejected assets, with `approvalState = rejected`. */
export const AssetStatus = z.enum([
  "draft",
  "processing",
  "review",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "archived",
]);
export type AssetStatus = z.infer<typeof AssetStatus>;

export const ApprovalState = z.enum(["pending", "approved", "rejected"]);
export type ApprovalState = z.infer<typeof ApprovalState>;

export const AssetType = z.enum([
  "source_original",
  "transcript",
  "clip",
  "clip_enriched",
  "thumbnail",
  "creative_image",
  "caption_track",
  "promo_vertical",
  "promo_landscape",
  "promo_store_portrait",
  "promo_store_landscape",
  "storyboard",
  "creative_direction_md",
  "audio_master",
  "reference_frames",
]);
export type AssetType = z.infer<typeof AssetType>;

export const JobStatus = z.enum([
  "queued",
  "started",
  "progress",
  "retrying",
  "completed",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const SourceStatus = z.enum([
  "discovered",
  "queued",
  "downloading",
  "ready",
  "failed",
  "archived",
]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const RightsClass = z.enum(["owned", "licensed", "third_party_attested", "unknown"]);
export type RightsClass = z.infer<typeof RightsClass>;

export const PublishStatus = z.enum([
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
]);
export type PublishStatus = z.infer<typeof PublishStatus>;

export const ProjectKind = z.enum(["shorts", "promo"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const Platform = z.enum([
  "x",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "threads",
  "pinterest",
  "reddit",
  "bluesky",
]);
export type Platform = z.infer<typeof Platform>;

/** Allowed transitions for the asset state machine. Anything not listed throws. */
export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  draft: ["processing", "archived"],
  processing: ["review", "failed", "archived"],
  review: ["approved", "archived", "processing"],
  approved: ["scheduled", "archived", "review"],
  scheduled: ["publishing", "approved", "archived"],
  publishing: ["published", "failed"],
  published: ["archived"],
  failed: ["processing", "publishing", "archived"],
  archived: [],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}
