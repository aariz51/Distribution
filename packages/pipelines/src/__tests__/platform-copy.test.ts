import { describe, expect, it } from "vitest";
import { buildCopyPrompt, safeJson } from "../copy/platform-copy";
import type { ProductProfile } from "@distribution/core";

const profile = {
  id: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  slug: "civia",
  version: 1,
  product: {
    name: "Civia",
    tagline: "Pass the US civics test",
    category: { primary: "education", tags: [] },
    features: [{ id: "00000000-0000-4000-8000-000000000003", title: "Timed mock test", priority: 1, evidenceAssetIds: [] }],
    competitors: [],
    audience: { summary: "Green card holders", segments: [], painPoints: [] },
    platforms: ["ios"],
    urls: {},
  },
  brand: { screenshotAssetIds: [], otherAssetIds: [], cta: "Download" },
  sources: { longFormSourceIds: [], connected: [] },
  publishing: { channelIds: [], timezone: "UTC", cadence: [], leadTimeMinutes: 30, minGapHours: 6 },
  contentPreferences: {
    captionPresetId: "basic", captionUseBrandColors: true, titleBanner: true, broll: false, sfx: true, outro: true,
    voice: "none", peoplePolicy: "off", cleanSource: false, clipLengthSec: { min: 30, max: 90 }, clipsPerSource: 8,
    copyTone: "plain", hashtagStrategy: "few", languages: ["en"],
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies ProductProfile;

describe("platform copy prompt", () => {
  it("injects product context, transcript and per-platform rules", () => {
    const { system, user } = buildCopyPrompt({ profile, platforms: ["x", "youtube"], transcriptExcerpt: "the FDA allows companies to decide", assetKind: "clip", durationSec: 42 });
    expect(user).toContain("PRODUCT: Civia");
    expect(user).toContain("Timed mock test");
    expect(user).toContain("- x: caption ≤ 280 chars, no title");
    expect(user).toContain("- youtube: caption ≤ 5000 chars, title ≤ 100 chars");
    expect(system).toContain("Never invent features");
    expect(system).toContain("lower end");
  });
  it("safeJson tolerates fences and prose", () => {
    expect(safeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeJson('Sure! Here it is: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(() => safeJson("nothing here")).toThrow();
  });
});
