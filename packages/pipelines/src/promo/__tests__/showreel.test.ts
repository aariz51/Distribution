import { describe, expect, it } from "vitest";
import type { ProductProfile } from "@distribution/core";
import { DEFAULT_INSPIRATION_URL, DirectorPlan, PlanError, PlanScene, SHOWREEL_PROMPT, compileShowreel, directorBrief, resolveInspiration } from "../showreel";
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
const keys = Object.keys(screens5);
const plan = (scenes: unknown[]) => DirectorPlan.parse({ concept: "A test concept for the compiler.", scenes });
const compile = (p: DirectorPlan, prof = profile()) => compileShowreel({ plan: p, profile: prof, screenKeys: keys, screens: screens5, logo: "logo/app-logo.png", theme: themeForProduct(prof) });
const good = [
  { kind: "kinetic", seconds: 2, copy: { w1: "Study.", w2: "Practice." } },
  { kind: "cube", seconds: 3, transition: "iris", screens: [1, 2, 3], copy: { f1: "Study every official question", f2: "Take a timed mock test" } },
  { kind: "wall", seconds: 3, transition: "slash", copy: { title: "Pass the", titleAccent: "civics test" } },
  { kind: "dashboard", seconds: 3, transition: "zoom", screens: [4], copy: { pre: "Practice with", accent: "instant feedback" } },
  { kind: "logo", seconds: 4, transition: "flash", copy: {} },
];

describe("the three inspiration modes", () => {
  it("uses the user's video when one is given, whatever the toggle says", () => {
    expect(resolveInspiration({ inspirationUrl: "https://youtu.be/abc", useDefaultInspiration: true })).toEqual({ mode: "custom", url: "https://youtu.be/abc" });
  });
  it("uses the default video only when the toggle is on", () => {
    expect(resolveInspiration({ useDefaultInspiration: true })).toEqual({ mode: "default", url: "https://www.youtube.com/watch?v=9sMVY15d7BA" });
    expect(DEFAULT_INSPIRATION_URL).toBe("https://www.youtube.com/watch?v=9sMVY15d7BA");
  });
  it("fetches nothing when there is no video and the toggle is off (its default)", () => {
    expect(resolveInspiration({})).toEqual({ mode: "none", url: null });
    expect(resolveInspiration({ inspirationUrl: "   ", useDefaultInspiration: false })).toEqual({ mode: "none", url: null });
  });
  it("hands the exact creative prompt to the director in the no-inspiration mode, and only there", () => {
    expect(SHOWREEL_PROMPT.startsWith("Create a dynamic, premium 15-second motion graphics showreel that feels like a résumé piece")).toBe(true);
    expect(SHOWREEL_PROMPT).toContain("7–11 seconds — Creative Peak");
    expect(SHOWREEL_PROMPT.endsWith("Go all out. Surprise me. Make the 15 seconds count.")).toBe(true);
    const none = directorBrief({ profile: profile(), inspiration: resolveInspiration({}), breakdown: null, screenshotCount: 5 });
    expect(none.user).toContain(`"""\n${SHOWREEL_PROMPT}\n"""`);
    const own = directorBrief({ profile: profile(), inspiration: resolveInspiration({}), screenshotCount: 3, prompt: "Line one.\n\nLine two." });
    expect(own.user).toContain(`"""\nLine one.\n\nLine two.\n"""`);
    expect(own.user).not.toContain(SHOWREEL_PROMPT);
    const withRef = directorBrief({ profile: profile(), inspiration: resolveInspiration({ useDefaultInspiration: true }), breakdown: null, screenshotCount: 5 });
    expect(withRef.user).not.toContain(SHOWREEL_PROMPT);
    expect(withRef.user).toContain("9sMVY15d7BA");
  });
});

describe("compiling a director's plan", () => {
  it("fills exactly 15 seconds at 60fps and ends on the logo", () => {
    const { storyboard } = compile(plan(good));
    expect(storyboard.durationFrames).toBe(900);
    expect(storyboard.scenes.reduce((n, s) => n + s.duration, 0)).toBe(900);
    expect(storyboard.scenes.at(-1)!.kind).toBe("logo");
    expect(storyboard.scenes[0]!.transition).toBe("cut");
    expect(storyboard.scenes[1]!.transition).toBe("iris");
  });
  it("writes every slot a kind reads, so no generic fallback line can render", () => {
    const { storyboard } = compile(plan(good));
    const dash = storyboard.scenes.find((s) => s.kind === "dashboard")!;
    expect(dash.copy.post).toBe("");
    expect(dash.copy.chip).toBe("");
  });
  it("shows store badges only for platforms the product is on", () => {
    const iosOnly = profile({ platforms: ["ios"] });
    const logo = compile(plan(good), iosOnly).storyboard.scenes.at(-1)!;
    expect(logo.copy.badge1).toBe("App Store");
    expect(logo.copy.badge2).toBe("");
  });
  it("rejects invented numbers but allows the product's own", () => {
    const invented = plan([{ kind: "kinetic", seconds: 3, copy: { w1: "10x faster" } }, ...good.slice(1)]);
    expect(() => compile(invented)).toThrow(PlanError);
    const own = plan([{ kind: "kinetic", seconds: 3, copy: { w1: "All 128" } }, ...good.slice(1)]);
    expect(() => compile(own)).not.toThrow();
  });
  it("collects every problem: unknown keys, missing essentials, screenshots that do not exist, no logo", () => {
    const bad = plan([
      { kind: "kinetic", seconds: 3, copy: { headline: "x" } },
      { kind: "cube", seconds: 3, screens: [9], copy: { f1: "Study every official question" } },
      { kind: "tagline", seconds: 3, copy: { w1: "Study." } },
      { kind: "wall", seconds: 3, copy: { title: "Pass" } },
    ]);
    try {
      compile(bad);
      throw new Error("expected PlanError");
    } catch (e) {
      const problems = (e as PlanError).problems.join(" | ");
      expect(problems).toMatch(/last scene must be `logo`/);
      expect(problems).toMatch(/unknown copy key "headline"/);
      expect(problems).toMatch(/needs copy "w1"/);
      expect(problems).toMatch(/screenshot 9/);
    }
  });
});

describe("director plan ground", () => {
  it("drops a ground value no scene can use instead of rejecting the plan", () => {
    expect(PlanScene.parse({ kind: "kinetic", seconds: 3, ground: "accent" }).ground).toBeUndefined();
    expect(PlanScene.parse({ kind: "typewriter", seconds: 3, ground: "dark" }).ground).toBe("dark");
  });
});
