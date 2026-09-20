import { describe, expect, it } from "vitest";
import { enrichStepsFor, orderSteps, rebaseWords } from "../steps";
import { brollArgv, brollEnv, brollScenePlanPath } from "../../sidecars";

describe("enrichStepsFor", () => {
  it("returns enabled flags in the fixed broll → sfx → outro order", () => {
    expect(enrichStepsFor({ broll: true, sfx: true, outro: true })).toEqual(["broll", "sfx", "outro"]);
    expect(enrichStepsFor({ broll: false, sfx: true, outro: true })).toEqual(["sfx", "outro"]);
    expect(enrichStepsFor({ broll: true, sfx: false, outro: false })).toEqual(["broll"]);
    expect(enrichStepsFor({ broll: false, sfx: false, outro: false })).toEqual([]);
  });
  it("orderSteps normalises any requested subset", () => {
    expect(orderSteps(["outro", "broll", "outro"])).toEqual(["broll", "outro"]);
  });
});

describe("rebaseWords", () => {
  const words = [
    { text: "before", start: 0, end: 1 },
    { text: "edge", start: 9.5, end: 10.5, speaker: "A" },
    { text: "inside", start: 12, end: 13 },
    { text: "tail", start: 19.8, end: 20.4 },
    { text: "after", start: 20, end: 21 },
  ];
  it("keeps overlapping words and rebases to clip-relative seconds (broll.rs:81-109)", () => {
    const out = rebaseWords(words, 10, 20);
    expect(out.map((w) => w.text)).toEqual(["edge", "inside", "tail"]);
    expect(out[0]).toEqual({ text: "edge", start: -0.5, end: 0.5, speaker: "A" });
    expect(out[1]).toEqual({ text: "inside", start: 2, end: 3 });
    expect(out[2]!.start).toBeCloseTo(9.8);
  });
  it("returns [] when nothing overlaps", () => {
    expect(rebaseWords(words, 100, 110)).toEqual([]);
  });
});

describe("brollArgv / brollEnv", () => {
  it("builds the Rust argv (broll.rs:141-156) with the transcript last", () => {
    const argv = brollArgv("/w/clip.mp4", { topic: "the hook", output: "/w/clip_broll.mp4", skillDir: "/skill", transcriptJsonPath: "/w/t.json" }, "/assets");
    expect(argv).toEqual(["--clip", "/w/clip.mp4", "--topic", "the hook", "--skill-dir", "/skill", "--output", "/w/clip_broll.mp4", "--assets", "/assets", "--transcript", "/w/t.json"]);
  });
  it("omits --transcript when there are no words and defaults the skill dir", () => {
    const argv = brollArgv("/w/clip.mp4", { topic: "t", output: "/w/o.mp4" }, "/assets");
    expect(argv).not.toContain("--transcript");
    expect(argv[argv.indexOf("--skill-dir") + 1]).toMatch(/vendor\/b-rolls$|BROLLS/);
  });
  it("always sets BROLL_PEOPLE_POLICY explicitly and passes API keys through", () => {
    const env = brollEnv({ peoplePolicy: "off" }, { PEXELS_API_KEY: "px", ANTHROPIC_API_KEY: "ak", HOME: "/h" });
    expect(env).toEqual({ BROLL_PEOPLE_POLICY: "off", PEXELS_API_KEY: "px", ANTHROPIC_API_KEY: "ak" });
    expect(brollEnv({ peoplePolicy: "no-people", videoUseCacheDir: "/cache" }, {}).B_ROLLS_CACHE_DIR).toBe("/cache");
  });
  it("scene plan lives in edit_<stem> beside the clip", () => {
    expect(brollScenePlanPath("/w/clip.mp4")).toBe("/w/edit_clip/scene_plan.json");
  });
});
