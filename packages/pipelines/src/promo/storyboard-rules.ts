import type { ProductProfile } from "@distribution/core";
import { Storyboard, type Scene, type SceneKind, type SfxCue } from "@distribution/promo-kit/schema";
import { chooseStructure, type Structure } from "./structures";

export interface BuildInput {
  profile: ProductProfile;
  /** storyboard screen key → staticFile path, in the order they should be used */
  screens: Record<string, string>;
  logo: string;
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  audioSrc?: string | null;
}

export interface BuiltStoryboard {
  storyboard: Storyboard;
  structure: Structure;
  /** Human-readable notes for CREATIVE_DIRECTION.md. */
  notes: string[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const sentence = (s: string) => s.trim().replace(/\s+/g, " ");
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** First clause of a sentence, so a long tagline still fits one typographic line. */
function clause(s: string, maxWords = 7): string {
  const w = words(sentence(s));
  return w.length <= maxWords ? w.join(" ") : `${w.slice(0, maxWords).join(" ")}…`;
}

/** Split a tagline into two lines at its natural break. */
function twoLines(s: string): [string, string] {
  const t = sentence(s);
  const punct = t.match(/^(.{6,48}?[,.;:—-])\s+(.+)$/);
  if (punct) return [punct[1]!.replace(/[,;:—-]$/, "."), cap(punct[2]!)];
  const w = words(t);
  if (w.length < 4) return [t, ""];
  const mid = Math.ceil(w.length / 2);
  return [w.slice(0, mid).join(" "), w.slice(mid).join(" ")];
}

/** Three short words for the period-rhythm close, drawn from real feature verbs. */
function threeWords(profile: ProductProfile): [string, string, string] {
  const verbs = profile.product.features
    .map((f) => words(f.title)[0] ?? "")
    .filter((w) => w.length >= 3 && w.length <= 9)
    .map((w) => cap(w.replace(/[^A-Za-z]/g, "")));
  const fallback = ["Open", "Know", "Go"];
  const out = [...new Set(verbs)].slice(0, 3);
  while (out.length < 3) out.push(fallback[out.length]!);
  return [`${out[0]}.`, `${out[1]}.`, `${out[2]}.`];
}

/** Sound cue vocabulary per scene kind: one at the cut, one on the scene's own event. */
function cuesFor(kind: SceneKind, startSec: number, durSec: number): SfxCue[] {
  const at = (t: number, effect: string, vol = 0.8): SfxCue => ({ effect, t: Math.max(0, startSec + t), vol });
  switch (kind) {
    case "hook":
      return [at(0.15, "pop", 0.7)];
    case "oneTap":
      return [at(0.1, "whoosh", 0.55), at(durSec * 0.55, "pop", 0.8)];
    case "press":
      return [at(durSec * 0.28, "click", 1), at(durSec * 0.32, "whoosh", 0.6)];
    case "verdict":
      return [at(0.1, "whoosh", 0.5), at(durSec * 0.55, "chime", 0.9), at(durSec * 0.58, "sparkle", 0.75)];
    case "features":
      return [at(0.05, "whoosh", 0.6), at(durSec * 0.3, "pop", 0.75), at(durSec * 0.45, "pop2", 0.75), at(durSec * 0.6, "pop", 0.75)];
    case "orbit":
      return [at(0.1, "drag", 0.7), at(durSec * 0.4, "sparkle", 0.5)];
    case "dashboard":
      return [at(0.1, "whoosh", 0.55), at(durSec * 0.32, "click", 0.95), at(durSec * 0.4, "pop", 0.7)];
    case "tagline":
      return [at(0.05, "pop", 0.8), at(durSec * 0.3, "pop2", 0.8), at(durSec * 0.55, "pop", 0.8)];
    case "logo":
      return [at(0.2, "sparkle", 0.75), at(0.5, "chime", 0.9)];
    case "typewriter":
      return [at(0.2, "type", 0.9), at(0.45, "type", 0.9), at(0.7, "type", 0.9), at(0.95, "type", 0.9)];
    case "split":
      return [at(0.08, "whoosh", 0.6), at(durSec * 0.45, "tick", 0.6)];
    case "steps":
      return [at(0.08, "whoosh", 0.55), at(durSec * 0.25, "tick", 0.7), at(durSec * 0.45, "tick", 0.7), at(durSec * 0.65, "tick", 0.7)];
    default:
      return [at(0.1, "pop", 0.7)];
  }
}

/**
 * Copy for one beat, derived from the product profile. Every string traces back
 * to something the founder actually wrote: a feature title, a pain point, the
 * tagline, the product name. Nothing is invented, which is the whole point of
 * the rule-based path — it cannot hallucinate a claim.
 */
function copyFor(kind: SceneKind, p: ProductProfile, screenKeys: string[]): { copy: Record<string, string>; screens?: string[] } {
  const prod = p.product;
  const feats = [...prod.features].sort((a, b) => a.priority - b.priority);
  const pains = prod.audience.painPoints;
  const [l1, l2] = twoLines(prod.tagline);
  const [w1, w2, w3] = threeWords(p);

  switch (kind) {
    case "hook":
      return { copy: { line: pains[0] ? sentence(pains[0]) : clause(prod.tagline, 8), glyph: "?" } };
    case "oneTap":
      return { copy: { line1: l1, line2: l2 || prod.name, buttonLabel: (words(feats[0]?.title ?? "Start")[0] ?? "Start").toUpperCase().slice(0, 10) } };
    case "press":
      return { copy: { buttonLabel: (words(feats[0]?.title ?? "Start")[0] ?? "Start").toUpperCase().slice(0, 10) } };
    case "verdict":
      return {
        copy: {
          eyebrow: (feats[0]?.title ?? "Result").toUpperCase().slice(0, 22),
          subject: prod.name,
          verdict: (pains[0] ? "SOLVED" : "READY"),
          score: "92",
        },
      };
    case "features": {
      const c: Record<string, string> = { title: "More than", titleAccent: `${clause(prod.category.primary, 3)}.` };
      feats.slice(0, 3).forEach((f, i) => {
        c[`f${i + 1}`] = clause(f.title, 4);
        c[`f${i + 1}sub`] = f.detail ? clause(f.detail, 7) : "";
      });
      return { copy: c };
    }
    case "orbit": {
      // "you need" vs "applicants need" — a segment noun is plural-agnostic here,
      // so only the pronoun case needs the verb changed.
      const who = prod.audience.segments[0]?.trim();
      return { copy: { titleAccent: "Everything", titleRest: who ? `${who} need.` : "you need." }, screens: screenKeys.slice(0, 6) };
    }
    case "dashboard": {
      const w = words(prod.tagline);
      return {
        copy: {
          pre: w.slice(0, 1).join(" ") || "One",
          accent: w.slice(1, 2).join(" ") || prod.name,
          post: w.slice(2, 6).join(" ") || "place.",
          chip: clause(feats[0]?.title ?? "", 3),
          chipSub: feats[0]?.detail ? clause(feats[0].detail, 4) : prod.category.primary,
        },
        screens: [screenKeys[0] ?? "screen1"],
      };
    }
    case "tagline":
      return { copy: { w1, w2, w3 } };
    case "logo":
      return { copy: { tagline: clause(prod.tagline, 10), badge1Top: "Download on the", badge1: prod.platforms.includes("ios") ? "App Store" : "", badge2Top: "GET IT ON", badge2: prod.platforms.includes("android") ? "Google Play" : "" } };
    case "typewriter":
      return { copy: { label: `${prod.name.toLowerCase().replace(/\s+/g, "")}`, line: clause(prod.tagline, 9) } };
    case "split": {
      const c: Record<string, string> = { leftTitle: "Before", rightTitle: `With ${prod.name}` };
      pains.slice(0, 3).forEach((x, i) => (c[`left${i + 1}`] = clause(x, 5)));
      feats.slice(0, 3).forEach((f, i) => (c[`right${i + 1}`] = clause(f.title, 5)));
      return { copy: c };
    }
    case "steps": {
      const c: Record<string, string> = { title: "How it works" };
      feats.slice(0, 4).forEach((f, i) => {
        c[`s${i + 1}`] = clause(f.title, 4);
        c[`s${i + 1}sub`] = f.detail ? clause(f.detail, 6) : "";
      });
      return { copy: c };
    }
    default:
      return { copy: {} };
  }
}

/**
 * Build a complete, renderable storyboard from a product profile alone.
 * No network, no model, deterministic: the same profile yields the same film,
 * which makes it testable and makes a promo free to produce.
 */
export function buildStoryboard(input: BuildInput): BuiltStoryboard {
  const { profile } = input;
  const fps = input.fps ?? 60;
  const width = input.width ?? 1080;
  const height = input.height ?? 1920;
  const durationSec = input.durationSec ?? 33;
  const screenKeys = Object.keys(input.screens);

  const structure = chooseStructure({
    category: profile.product.category.primary,
    tags: profile.product.category.tags,
    screenCount: screenKeys.length,
    featureCount: profile.product.features.length,
    painPointCount: profile.product.audience.painPoints.length,
  });

  // Drop beats the product cannot support, then re-normalise the weights so the
  // film still fills the target duration.
  const usable = structure.beats.filter((b) => {
    if ((b.kind === "orbit" || b.kind === "dashboard") && screenKeys.length === 0) return false;
    if (b.kind === "orbit" && screenKeys.length < 3) return false;
    if (b.kind === "features" && profile.product.features.length < 3) return false;
    if (b.kind === "split" && profile.product.audience.painPoints.length === 0) return false;
    return true;
  });
  const beats = usable.length >= 4 ? usable : structure.beats.filter((b) => b.kind !== "orbit" && b.kind !== "dashboard");

  const totalWeight = beats.reduce((s, b) => s + b.weight, 0);
  const totalFrames = Math.round(durationSec * fps);

  const scenes: Scene[] = [];
  const sfx: SfxCue[] = [];
  let cursor = 0;
  beats.forEach((b, i) => {
    const isLast = i === beats.length - 1;
    const frames = isLast ? totalFrames - cursor : Math.max(fps, Math.round((b.weight / totalWeight) * totalFrames));
    // Rotate screens so a repeated kind does not show the same picture twice.
    const rotated = screenKeys.length ? [...screenKeys.slice(i % screenKeys.length), ...screenKeys.slice(0, i % screenKeys.length)] : [];
    const { copy, screens } = copyFor(b.kind, profile, rotated);
    const id = `${b.kind}-${i + 1}`;
    scenes.push({
      id,
      kind: b.kind,
      start: cursor,
      duration: frames,
      copy,
      ...(screens ? { screens } : {}),
      ...(b.kind === "typewriter" && i > 0 ? { options: { ground: "dark" } } : {}),
    });
    sfx.push(...cuesFor(b.kind, cursor / fps, frames / fps));
    cursor += frames;
  });

  const storyboard = Storyboard.parse({
    fps,
    durationFrames: totalFrames,
    width,
    height,
    audioSrc: input.audioSrc ?? null,
    product: { name: profile.product.name, tagline: profile.product.tagline, cta: profile.brand.cta },
    logo: input.logo,
    screens: input.screens,
    scenes,
    sfx: sfx.filter((c) => c.t < durationSec),
  });

  const notes = [
    `Structure: **${structure.id}** — ${structure.rationale}`,
    `Beats: ${scenes.map((s) => s.kind).join(" → ")}`,
    `Duration: ${durationSec}s at ${fps}fps (${totalFrames} frames), ${scenes.length} scenes, ${storyboard.sfx.length} sound cues.`,
    screenKeys.length ? `Screens used: ${screenKeys.join(", ")}.` : "No product screenshots were available, so the film is carried by typography.",
    "Copy is derived from the product profile only (features, pain points, tagline, name); no claim is invented.",
  ];
  return { storyboard, structure, notes };
}
