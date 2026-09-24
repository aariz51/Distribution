import { beforeEach, expect, it, vi } from "vitest";
import type { Db, assets } from "@distribution/db";

const state = vi.hoisted(() => ({
  prefs: { broll: false, sfx: true, outro: true },
  blockedKeys: new Set<string>(),
}));
vi.mock("../common", () => ({ loadProfile: async () => ({ contentPreferences: state.prefs, publishing: { cadence: [{ platform: "instagram" }] } }) }));
vi.mock("../screening", () => ({ requireScreenedOutput: async (key: string) => { if (state.blockedKeys.has(key)) throw new Error("Changed or unverified media"); } }));
vi.mock("../sidecars", () => ({ validateCreative: async () => {} }));
vi.mock("@distribution/storage", () => ({ getStorage: () => ({ localPathFor: async (key: string) => key }) }));

import { reconcileShortsProject } from "../completion";
import { THUMBNAIL_VARIANTS } from "../../thumbnail-render";
type Asset = typeof assets.$inferSelect;
const clip = { id: "clip", candidateId: "candidate", productId: "product", projectId: "project", type: "clip", thumbnailAssetId: "portrait", metadata: {}, storageKey: "clip.mp4", status: "review", approvalState: "pending" } as Asset;
const covers = THUMBNAIL_VARIANTS.map(v => ({ id: v.name, productId: "product", projectId: "project", type: "thumbnail", derivedFromAssetId: "clip", width: v.size[0], height: v.size[1], metadata: { variant: v.name }, storageKey: `${v.name}.png`, status: "review", approvalState: "pending" } as unknown as Asset));
function enriched(id: string, steps?: unknown): Asset {
  return { ...clip, id, type: "clip_enriched", derivedFromAssetId: "clip", storageKey: `${id}.mp4`, metadata: { steps } } as Asset;
}
async function completes(derivatives: Asset[]): Promise<boolean> {
  const rows: unknown[][] = [
    [{ id: "project", productId: "product", kind: "shorts" }],
    [{ id: "candidate", selected: true }],
    [clip, ...covers, ...derivatives],
    [{ assetId: "clip", platform: "instagram" }],
  ];
  const update = vi.fn(() => ({ set: () => ({ where: async () => {} }) }));
  const db = {
    select: () => ({ from: () => {
      const query = { where: async () => rows.shift(), innerJoin: () => query };
      return query;
    } }),
    update,
  } as unknown as Db;
  await reconcileShortsProject(db, "product", "project");
  return update.mock.calls.length > 0;
}
beforeEach(() => { state.prefs = { broll: false, sfx: true, outro: true }; state.blockedKeys.clear(); });

it("does not complete when a derivative omitted a profile-required step", async () => {
  expect(await completes([enriched("outro-only", ["outro"])])).toBe(false);
});
it("requires applied steps, not only the request or malformed metadata", async () => {
  for (const steps of [undefined, "sfx,outro", []]) {
    const output = enriched("missing", steps);
    output.metadata.requestedSteps = ["sfx", "outro"];
    expect(await completes([output])).toBe(false);
  }
});
it("requires one derivative containing all required steps rather than a union of separate outputs", async () => {
  expect(await completes([enriched("sfx", ["sfx"]), enriched("outro", ["outro"])])).toBe(false);
});
it("accepts a complete derivative even alongside older partial derivatives and additional optional steps", async () => {
  expect(await completes([enriched("old", ["outro"]), enriched("complete", ["broll", "sfx", "outro"])])).toBe(true);
});
it("keeps proof, cover association, parent association and failure requirements", async () => {
  for (const patch of [{ status: "failed" }, { approvalState: "rejected" }, { thumbnailAssetId: "other" }, { derivedFromAssetId: "other" }]) {
    expect(await completes([{ ...enriched("complete", ["sfx", "outro"]), ...patch } as Asset])).toBe(false);
  }
  state.blockedKeys.add("complete.mp4");
  expect(await completes([enriched("complete", ["sfx", "outro"])])).toBe(false);
});
it("does not require optional enrichment when the saved profile requests no steps", async () => {
  state.prefs = { broll: false, sfx: false, outro: false };
  expect(await completes([])).toBe(true);
});
