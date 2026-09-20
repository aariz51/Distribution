import { z } from "zod";
import { ApprovalState, AssetStatus, AssetType, Platform } from "../statuses.js";

export const AssetRecord = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  projectId: z.uuid().nullable(),
  type: AssetType,
  sourceId: z.uuid().nullable(),
  derivedFromAssetId: z.uuid().nullable(),
  storageKey: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  sizeBytes: z.number().int().nullable(),
  thumbnailAssetId: z.uuid().nullable(),
  status: AssetStatus,
  approvalState: ApprovalState,
  approvalReason: z.string().nullable(),
  profileVersion: z.number().int(),
  jobId: z.uuid().nullable(),
  platforms: z.array(Platform),
  scheduledFor: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  publishResult: z.record(z.string(), z.unknown()).nullable(),
  failureReason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AssetRecord = z.infer<typeof AssetRecord>;

export const AssetCopy = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  platform: Platform,
  hook: z.string(),
  title: z.string(),
  caption: z.string(),
  description: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  version: z.number().int(),
  approved: z.boolean(),
});
export type AssetCopy = z.infer<typeof AssetCopy>;
