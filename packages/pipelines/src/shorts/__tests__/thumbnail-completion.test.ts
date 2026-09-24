import { expect, it } from "vitest";
import type { assets } from "@distribution/db";
import { hasThumbnailVariants } from "../completion";
import { THUMBNAIL_VARIANTS } from "../../thumbnail-render";
type Asset = typeof assets.$inferSelect;
const clip = { id: "clip", productId: "product", projectId: "project", thumbnailAssetId: "portrait" } as Asset;
const covers = THUMBNAIL_VARIANTS.map(v => ({ id: v.name, productId: "product", projectId: "project", type: "thumbnail", derivedFromAssetId: "clip", width: v.size[0], height: v.size[1], metadata: { variant: v.name }, status: "review", approvalState: "pending" } as unknown as Asset));
const readable = new Set(covers.map(c => c.id));
it("requires every real cover variant, including a readable associated portrait", () => {
  expect(hasThumbnailVariants(clip, covers, readable)).toBe(true);
  expect(hasThumbnailVariants(clip, covers.slice(0, 2), readable)).toBe(false);
  expect(hasThumbnailVariants(clip, covers, new Set(["portrait", "landscape"]))).toBe(false);
  expect(hasThumbnailVariants({ ...clip, thumbnailAssetId: null }, covers, readable)).toBe(false);
});
it("does not count another product's cover or a failed, archived, rejected or wrong-size output", () => {
  for (const patch of [{ productId: "other" }, { projectId: "other" }, { derivedFromAssetId: "other" }, { status: "failed" }, { status: "archived" }, { approvalState: "rejected" }, { width: 1 }]) {
    expect(hasThumbnailVariants(clip, [{ ...covers[0]!, ...patch } as Asset, ...covers.slice(1)], readable)).toBe(false);
  }
});
