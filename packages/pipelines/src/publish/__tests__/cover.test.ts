import { expect, it } from "vitest";
import { youtubeCover } from "../cover";
import type { assets } from "@distribution/db";
type Asset = typeof assets.$inferSelect;
const video = { id: "video", productId: "product", type: "clip", thumbnailAssetId: "portrait" } as Asset;
const portrait = { id: "portrait", productId: "product", type: "thumbnail", derivedFromAssetId: "video", metadata: { variant: "portrait" }, status: "approved", approvalState: "approved" } as unknown as Asset;
const landscape = { ...portrait, id: "landscape", metadata: { variant: "landscape" } } as Asset;
it("requires approval of the deterministic cover, not only the displayed portrait", () => {
  expect(() => youtubeCover(video, [portrait, { ...landscape, approvalState: "pending" }])).toThrow("Approve");
  expect(youtubeCover(video, [portrait, landscape]).id).toBe("landscape");
  expect(() => youtubeCover(video, [{ ...landscape, productId: "other" }])).toThrow("Approve");
  expect(() => youtubeCover(video, [{ ...portrait, status: "archived" }])).toThrow("Approve");
});
it("uses the original clip's approved landscape variant for enrichment", () => {
  expect(youtubeCover({ ...video, id: "enriched", type: "clip_enriched", derivedFromAssetId: "video" }, [portrait, landscape]).id).toBe("landscape");
});
