import { expect, it } from "vitest";
import { rankReferences, type ReferenceCandidate } from "../reference-ranking";
const target = { id: "product", category: { primary: "health", tags: [] }, platforms: ["ios"], ground: "#ffffff", durationSec: 30 };
const base: ReferenceCandidate = { id: "a", title: "Reference", url: "https://youtu.be/4Leardp_AGc", durationSec: 30, categoryTags: ["health"], productType: "mobile-app", groundPreference: "light", curatorScore: 5, lastUsedProductId: null, visualLanguage: [] };
it("applies the specified weights and explains matched attributes", () => { const ranked = rankReferences([base], target)[0]!; expect(ranked.score).toBe(9); expect(ranked.reasons).toHaveLength(4); });
it("penalizes the last reference used for this product", () => { const ranked = rankReferences([{ ...base, lastUsedProductId: "product" }, { ...base, id: "b" }], target); expect(ranked[0]!.id).toBe("b"); expect(ranked[1]!.score).toBe(7); });
it("keeps ties deterministic without mutating candidates", () => { const candidates = [{ ...base, id: "z" }, base]; expect(rankReferences(candidates, target).map(r => r.id)).toEqual(["a", "z"]); expect(candidates[0]!.id).toBe("z"); });
it("does not award missing data a match", () => { const ranked = rankReferences([{ ...base, categoryTags: [], productType: null, groundPreference: null, durationSec: null, curatorScore: 0 }], target); expect(ranked[0]!.score).toBe(0); });
