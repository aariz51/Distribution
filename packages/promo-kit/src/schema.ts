// ════════════════════════════════════════════════════════════════════════════
//  PROP CONTRACT for the promo kit. Pure data + zod — no React/Remotion imports,
//  so the worker pipeline can import it without pulling in the renderer.
//  `inputProps = { storyboard, theme }` drives every composition.
// ════════════════════════════════════════════════════════════════════════════
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB");

export const ThemeColors = z.object({
  // Base (background system)
  cream: hex,
  creamDeep: hex,
  blush: hex,
  // Brand primary / secondary / accent
  primary: hex,
  primarySoft: hex,
  primaryDeep: hex,
  accent: hex,
  accentSoft: hex,
  gold: hex,
  goldSoft: hex,
  // Result semantics
  safe: hex,
  safeSoft: hex,
  caution: hex,
  avoid: hex,
  // Ink
  ink: hex,
  inkSoft: hex,
  white: hex,
});
export type ThemeColors = z.infer<typeof ThemeColors>;

export const FontFile = z.object({
  family: z.string().min(1),
  /** staticFile-relative path inside public/, e.g. "fonts/Baloo2.ttf" */
  src: z.string().min(1),
  weight: z.string().default("100 900"),
});

export const Theme = z.object({
  colors: ThemeColors,
  fonts: z.object({
    /** display face family name (must match a FontFile.family or a system font) */
    head: z.string().min(1),
    /** UI / body face family name */
    body: z.string().min(1),
    /** monospace face for "system voice" devices */
    mono: z.string().min(1).default("ui-monospace, SFMono-Regular, Menlo, monospace"),
    files: z.array(FontFile).default([]),
  }),
  /** native app-screen aspect (w/h); portrait phone ≈ 1080/2340 */
  screenRatio: z.number().positive().default(1080 / 2340),
});
export type Theme = z.infer<typeof Theme>;

/** The scene jobs the kit can perform. Nine from the template + signature devices. */
export const SceneKind = z.enum([
  "hook", // state the problem in one typographic line
  "oneTap", // the claim: one action solves it
  "press", // interaction proof — cursor presses real UI, dives in
  "verdict", // the payoff: result lands, reward fires
  "features", // breadth: three glass feature cards (template S5)
  "orbit", // range in motion — many screens at once
  "dashboard", // the money shot, held and annotated
  "tagline", // period-rhythm verbal close
  "logo", // lockup, store badges, exit
  "typewriter", // signature device: mono caret line, light or inverted ground
  "split", // signature device: light human world left / dark system right
  "steps", // signature device: numbered step rows
]);
export type SceneKind = z.infer<typeof SceneKind>;

export const Scene = z.object({
  id: z.string().min(1),
  kind: SceneKind,
  /** start frame (inclusive) */
  start: z.number().int().min(0),
  /** duration in frames */
  duration: z.number().int().min(1),
  /** per-kind copy slots; see COPY_SLOTS for the keys each kind reads */
  copy: z.record(z.string(), z.string()).default({}),
  /** keys into storyboard.screens */
  screens: z.array(z.string()).optional(),
  /** hex override for this scene's keyword/accent colour */
  accent: hex.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type Scene = z.infer<typeof Scene>;

export const SfxCue = z.object({
  effect: z.string().min(1),
  t: z.number().min(0),
  vol: z.number().min(0).max(2).default(0.8),
});
export type SfxCue = z.infer<typeof SfxCue>;

export const Storyboard = z.object({
  fps: z.number().int().min(24).max(60),
  durationFrames: z.number().int().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  /** staticFile-relative path of the pre-mixed master, or null for silent */
  audioSrc: z.string().nullable().optional(),
  product: z.object({ name: z.string().min(1), tagline: z.string().default(""), cta: z.string().default("") }),
  /** staticFile-relative logo path */
  logo: z.string().min(1),
  /** screen key → staticFile-relative path */
  screens: z.record(z.string(), z.string()),
  scenes: z.array(Scene).min(1),
  /** sound-effect cues consumed by scripts/build_audio.py --fx */
  sfx: z.array(SfxCue).default([]),
});
export type Storyboard = z.infer<typeof Storyboard>;

export const KitProps = z.object({ storyboard: Storyboard, theme: Theme });
export type KitProps = z.infer<typeof KitProps>;

/** Copy keys each kind reads (all optional; sensible fallbacks). Handed to the LLM. */
export const COPY_SLOTS: Record<SceneKind, string[]> = {
  hook: ["line (last word coloured)", "glyph (default ?)"],
  oneTap: ["line1", "line2 (coloured)", "buttonLabel"],
  press: ["buttonLabel"],
  verdict: ["eyebrow", "subject", "verdict", "score (0-100)"],
  features: ["title", "titleAccent", "f1", "f1sub", "f2", "f2sub", "f3", "f3sub"],
  orbit: ["titleAccent", "titleRest"],
  dashboard: ["pre", "accent", "post", "chip", "chipSub"],
  tagline: ["w1", "w2", "w3"],
  logo: ["tagline", "badge1Top", "badge1", "badge2Top", "badge2"],
  typewriter: ["label (mono eyebrow)", "line"],
  split: ["leftTitle", "left1", "left2", "left3", "rightTitle", "right1", "right2", "right3"],
  steps: ["title", "s1", "s1sub", "s2", "s2sub", "s3", "s3sub", "s4", "s4sub"],
};

/** Which kinds need at least one screen key. */
export const SCREEN_KINDS: Record<SceneKind, number> = {
  hook: 0, oneTap: 0, press: 0, verdict: 0, features: 0, orbit: 3, dashboard: 1, tagline: 0, logo: 0,
  typewriter: 0, split: 0, steps: 0,
};

/** The template's worked-example running order — a storyboard that reproduces
 *  it exactly is rejected by the pipeline (SKILL.md step 4). */
export const TEMPLATE_ORDER: SceneKind[] = ["hook", "oneTap", "press", "verdict", "features", "orbit", "dashboard", "tagline", "logo"];

export const SIGNATURE_KINDS: SceneKind[] = ["typewriter", "split", "steps"];

export const DEFAULT_THEME: Theme = {
  colors: {
    cream: "#F7F8FC",
    creamDeep: "#EEF0F8",
    blush: "#E3E6F5",
    primary: "#4F46E5",
    primarySoft: "#7A75EE",
    primaryDeep: "#3730A3",
    accent: "#DB2777",
    accentSoft: "#F472B6",
    gold: "#F59E0B",
    goldSoft: "#FCD34D",
    safe: "#10B981",
    safeSoft: "#6EE7B7",
    caution: "#F97316",
    avoid: "#EF4444",
    ink: "#1E2230",
    inkSoft: "#7A8296",
    white: "#FFFFFF",
  },
  fonts: {
    head: "Baloo 2",
    body: "InterVar",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    files: [
      { family: "Baloo 2", src: "fonts/Baloo2.ttf", weight: "400 800" },
      { family: "InterVar", src: "fonts/Inter.ttf", weight: "100 900" },
    ],
  },
  screenRatio: 1080 / 2340,
};

/** Neutral demo storyboard using the shipped placeholder screens (60fps, 33s). */
export function demoStoryboard(width = 1080, height = 1920): Storyboard {
  const fps = 60;
  const T = { hook: 0, typewriter: 210, press: 330, verdict: 450, split: 690, orbit: 900, dashboard: 1200, steps: 1500, tagline: 1740, logo: 1860, end: 2100 };
  const seg = (id: SceneKind, a: number, b: number, copy: Record<string, string>, screens?: string[]) => ({ id, kind: id, start: a, duration: b - a, copy, ...(screens ? { screens } : {}) });
  return {
    fps,
    durationFrames: T.end,
    width,
    height,
    audioSrc: null,
    product: { name: "Acme", tagline: "Your one-line product tagline", cta: "Download free" },
    logo: "logo/app-logo.png",
    screens: {
      dashboard: "app-screens/01-home.png",
      detail: "app-screens/02-detail.png",
      search: "app-screens/03-search.png",
      library: "app-screens/04-library.png",
      profile: "app-screens/05-profile.png",
      settings: "app-screens/06-settings.png",
      result: "app-screens/07-result.png",
    },
    scenes: [
      seg("hook", T.hook, T.typewriter, { line: "Every day, the same question.", glyph: "?" }),
      seg("typewriter", T.typewriter, T.press, { label: "acme.sys", line: "One tap. Zero doubt." }),
      seg("press", T.press, T.verdict, { buttonLabel: "SCAN" }),
      seg("verdict", T.verdict, T.split, { eyebrow: "ANSWER READY", subject: "Organic Oat Cereal", verdict: "ALL CLEAR", score: "92" }),
      seg("split", T.split, T.orbit, { leftTitle: "Before", left1: "Six tabs open", left2: "Three opinions", left3: "Still unsure", rightTitle: "With Acme", right1: "scan()", right2: "match → 12 sources", right3: "verdict: clear" }),
      seg("orbit", T.orbit, T.dashboard, { titleAccent: "Everything", titleRest: "built around you." }, ["detail", "search", "library", "profile", "settings", "result"]),
      seg("dashboard", T.dashboard, T.steps, { pre: "One", accent: "calm", post: "place.", chip: "On track", chipSub: "this week" }, ["dashboard"]),
      seg("steps", T.steps, T.tagline, { title: "How it works", s1: "Point", s1sub: "at any label", s2: "Tap", s2sub: "one button", s3: "Know", s3sub: "in a second" }),
      seg("tagline", T.tagline, T.logo, { w1: "Ask.", w2: "Know.", w3: "Move." }),
      seg("logo", T.logo, T.end, { tagline: "Your one-line product tagline", badge1Top: "Download on the", badge1: "App Store", badge2Top: "GET IT ON", badge2: "Google Play" }),
    ],
    sfx: [
      { effect: "type", t: 0.15, vol: 0.92 }, { effect: "type", t: 0.29, vol: 0.92 }, { effect: "pop", t: 0.7, vol: 0.8 },
      { effect: "type", t: 3.6, vol: 0.92 }, { effect: "type", t: 3.8, vol: 0.92 }, { effect: "type", t: 4.0, vol: 0.92 },
      { effect: "click", t: 5.87, vol: 1 }, { effect: "whoosh", t: 6.95, vol: 0.6 },
      { effect: "chime", t: 8.55, vol: 0.9 }, { effect: "sparkle", t: 8.72, vol: 0.78 },
      { effect: "whoosh", t: 11.55, vol: 0.6 }, { effect: "pop", t: 12.0, vol: 0.8 }, { effect: "pop2", t: 12.2, vol: 0.8 },
      { effect: "drag", t: 15.1, vol: 0.72 }, { effect: "sparkle", t: 15.55, vol: 0.55 },
      { effect: "whoosh", t: 20.3, vol: 0.6 }, { effect: "pop", t: 20.8, vol: 0.8 }, { effect: "click", t: 21.62, vol: 1 },
      { effect: "pop", t: 25.2, vol: 0.8 }, { effect: "pop2", t: 25.5, vol: 0.8 }, { effect: "pop", t: 25.8, vol: 0.8 },
      { effect: "pop", t: 29.15, vol: 0.8 }, { effect: "pop2", t: 29.42, vol: 0.8 }, { effect: "pop", t: 29.68, vol: 0.8 },
      { effect: "sparkle", t: 31.12, vol: 0.78 }, { effect: "chime", t: 31.45, vol: 0.9 },
    ],
  };
}
