import { expect, it } from "vitest";
import { DirectedStructure, parseModelJson, ReferenceAnalysis } from "../direction";
const beats = [{ kind: "hook", weight: 2 }, { kind: "dashboard", weight: 4 }, { kind: "tagline", weight: 2 }, { kind: "logo", weight: 3 }];
it("accepts a bounded edit plan and rejects fabricated result scenes", () => {
  expect(DirectedStructure.parse({ id: "reference-directed", rationale: "Hold real product proof before the closing lockup.", beats }).beats).toHaveLength(4);
  expect(DirectedStructure.safeParse({ id: "reference-directed", rationale: "Invent a rating", beats: [{ kind: "verdict", weight: 2 }, ...beats] }).success).toBe(false);
  expect(DirectedStructure.safeParse({ id: "reference-directed", rationale: "Unsafe timing", beats: beats.map(b => ({ ...b, weight: 100 })) }).success).toBe(false);
});
it("rejects missing lockups and empty reference observations", () => {
  expect(DirectedStructure.safeParse({ id: "reference-directed", rationale: "No closing brand", beats: [...beats].reverse() }).success).toBe(false);
  expect(ReferenceAnalysis.safeParse({ summary: "", visualLanguage: [], beats: [] }).success).toBe(false);
  expect(parseModelJson('```json\n{"valid":true}\n```')).toEqual({ valid: true });
});
