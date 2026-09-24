import { describe, expect, it } from "vitest";
import type { ProductProfile } from "@distribution/core";
import { TEMPLATE_ORDER } from "@distribution/promo-kit/schema";
import { buildStoryboard } from "../storyboard-rules";
import { chooseStructure } from "../structures";
import { themeForProduct } from "../theme";

function profile(over: Partial<ProductProfile["product"]> = {}, palette = true): ProductProfile {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    accountId: "00000000-0000-4000-8000-000000000002",
    slug: "acme",
    version: 3,
    product: {
      name: "Civia",
      tagline: "Pass the US civics test with confidence",
      category: { primary: "education", tags: [] },
      features: [
        { id: "00000000-0000-4000-8000-00000000000a", title: "Study every official question", detail: "All 128, sorted", priority: 1, evidenceAssetIds: [] },
        { id: "00000000-0000-4000-8000-00000000000b", title: "Practice with instant feedback", priority: 2, evidenceAssetIds: [] },
        { id: "00000000-0000-4000-8000-00000000000c", title: "Take a timed mock test", priority: 3, evidenceAssetIds: [] },
      ],
      competitors: [],
      audience: { summary: "Green card holders", segments: ["applicants"], painPoints: ["Six tabs open", "Three opinions"] },
      platforms: ["ios", "android"],
      urls: {},
      ...over,
    },
    brand: {
      screenshotAssetIds: [],
      otherAssetIds: [],
      cta: "Download free",
      ...(palette ? { palette: { ink: "#14171A", accent: "#1B3A6B", canvas: "#F6F5F1", ground: "#0D1114", extra: ["#546A8D"], source: "confirmed" as const, inferredFrom: [] } } : {}),
    },
    sources: { longFormSourceIds: [], connected: [] },
    publishing: { channelIds: [], timezone: "UTC", cadence: [], leadTimeMinutes: 30, minGapHours: 6 },
    contentPreferences: {
      captionPresetId: "basic", captionUseBrandColors: true, titleBanner: true, broll: false, sfx: true, outro: true,
      voice: "none", peoplePolicy: "off", cleanSource: false, clipLengthSec: { min: 30, max: 90 }, clipsPerSource: 8,
      copyTone: "plain", hashtagStrategy: "few", languages: ["en"],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const screens5 = { screen1: "app-screens/01.png", screen2: "app-screens/02.png", screen3: "app-screens/03.png", screen4: "app-screens/04.png", screen5: "app-screens/05.png" };

it("uses real product screens instead of inventing a numerical result or solved claim", () => {
  const { storyboard } = buildStoryboard({ profile: profile({ category: { primary: "health", tags: [] } }), screens: screens5, logo: "logo.png" });
  expect(storyboard.scenes.some(scene => scene.kind === "verdict")).toBe(false);
  expect(storyboard.scenes.some(scene => "score" in scene.copy)).toBe(false);
  expect(storyboard.scenes.filter(scene => scene.kind === "dashboard").length).toBeGreaterThan(0);
  const longTagline = "Know what is really inside any product before you choose";
  const long = buildStoryboard({ profile: profile({ tagline: longTagline }), screens: screens5, logo: "logo.png" });
  const proof = long.storyboard.scenes.find(scene => scene.kind === "dashboard")!;
  expect([proof.copy.pre, proof.copy.accent, proof.copy.post].join(" ")).toBe(longTagline);
});

describe("structure choice", () => {
  it("is deterministic and driven by the product, not a fixed default", () => {
    const edu = chooseStructure({ category: "education", tags: [], screenCount: 5, featureCount: 3, painPointCount: 2 });
    const dev = chooseStructure({ category: "devtools", tags: ["api"], screenCount: 5, featureCount: 3, painPointCount: 2 });
    const bare = chooseStructure({ category: "education", tags: [], screenCount: 0, featureCount: 3, painPointCount: 2 });
    expect(dev.id).toBe("system");
    expect(bare.id).toBe("typographic");
    expect(edu.id).not.toBe(dev.id);
    expect(chooseStructure({ category: "devtools", tags: ["api"], screenCount: 5, featureCount: 3, painPointCount: 2 }).id).toBe(dev.id);
  });
});

describe("buildStoryboard", () => {
  it("fills the requested duration exactly and leaves no gaps", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: screens5, logo: "logo/app-logo.png", durationSec: 33, fps: 60 });
    expect(storyboard.durationFrames).toBe(1980);
    let cursor = 0;
    for (const s of storyboard.scenes) {
      expect(s.start).toBe(cursor);
      cursor += s.duration;
    }
    expect(cursor).toBe(1980);
  });

  it("never reproduces the template's running order", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png" });
    expect(storyboard.scenes.map((s) => s.kind)).not.toEqual(TEMPLATE_ORDER);
  });

  it("only uses screen keys that exist", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png" });
    for (const s of storyboard.scenes) for (const k of s.screens ?? []) expect(storyboard.screens[k]).toBeTruthy();
  });

  it("drops screen-dependent beats when the product has no screenshots", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: {}, logo: "l.png" });
    const kinds = storyboard.scenes.map((s) => s.kind);
    expect(kinds).not.toContain("orbit");
    expect(kinds).not.toContain("dashboard");
    expect(storyboard.scenes.length).toBeGreaterThanOrEqual(4);
  });

  it("derives copy from the profile and invents nothing", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png" });
    const all = storyboard.scenes.flatMap((s) => Object.values(s.copy)).join(" ");
    expect(all).toContain("Six tabs open");
    // The product name reaches the film through storyboard.product, which the
    // logo scene renders; copy slots carry only the founder's own words.
    expect(storyboard.product.name).toBe("Civia");
    expect(all).toMatch(/Study every|Practice|timed mock/);
  });

  it("keeps every sound cue inside the film", () => {
    const { storyboard } = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png", durationSec: 20 });
    expect(storyboard.sfx.length).toBeGreaterThan(0);
    for (const c of storyboard.sfx) expect(c.t).toBeLessThan(20);
  });

  it("is deterministic", () => {
    const a = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png" }).storyboard;
    const b = buildStoryboard({ profile: profile(), screens: screens5, logo: "l.png" }).storyboard;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("themeForProduct", () => {
  it("maps the product palette onto every theme role", () => {
    const t = themeForProduct(profile());
    expect(t.colors.primary.toLowerCase()).toBe("#1b3a6b");
    expect(t.colors.cream.toLowerCase()).toBe("#f6f5f1");
    expect(t.colors.ink.toLowerCase()).toBe("#14171a");
    expect(t.colors.accent.toLowerCase()).toBe("#546a8d");
    // derived roles stay in the brand's world
    expect(t.colors.primarySoft).not.toBe(t.colors.primary);
    expect(t.colors.inkSoft).not.toBe(t.colors.ink);
  });
  it("falls back to the kit default when the product has no palette", () => {
    const t = themeForProduct(profile({}, false));
    expect(t.colors.primary).toBe("#4F46E5");
  });
});

 it("preserves complete hook and feature titles instead of cutting phrases", () => {
  const tagline = "Know what is really inside any product you buy";
  const p = profile({ tagline, audience: { summary: "Shoppers", segments: [], painPoints: [] } });
  const { storyboard } = buildStoryboard({ profile: p, screens: screens5, logo: "l.png", structure: {
    id: "copy-test", rationale: "Verify full product copy", beats: [
      { kind: "hook", weight: 1 }, { kind: "features", weight: 2 },
      { kind: "dashboard", weight: 2 }, { kind: "logo", weight: 1 },
    ],
  } });
  expect(storyboard.scenes[0]!.copy.line).toBe(tagline);
  const features = storyboard.scenes.find(scene => scene.kind === "features")!;
  p.product.features.forEach((feature, i) => expect(features.copy[`f${i + 1}`]).toBe(feature.title));
});
