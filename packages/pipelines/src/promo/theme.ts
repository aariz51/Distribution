import type { ProductProfile } from "@distribution/core";
import { DEFAULT_THEME, type Theme } from "@distribution/promo-kit/schema";

/** Lighten/darken a hex toward white or black by `t` (0..1). */
function shift(hex: string, t: number, toward: "white" | "black"): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const target = toward === "white" ? 255 : 0;
  const mix = (v: number) => Math.round(v + (target - v) * t);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The film's palette is the product's palette — not a preset with the brand
 * colour dropped in. The four roles the profile carries (ink / accent / canvas /
 * ground) become the whole seventeen-colour theme by derivation, so every glow,
 * card tint and semantic state stays in the product's world.
 */
export function themeForProduct(profile: ProductProfile): Theme {
  const p = profile.brand.palette;
  if (!p) return DEFAULT_THEME;
  const extra = p.extra ?? [];
  const secondary = extra[0] ?? shift(p.accent, 0.35, "black");
  const tertiary = extra[1] ?? shift(p.accent, 0.3, "white");
  return {
    colors: {
      cream: p.canvas,
      creamDeep: shift(p.canvas, 0.06, "black"),
      blush: shift(p.accent, 0.86, "white"),
      primary: p.accent,
      primarySoft: shift(p.accent, 0.3, "white"),
      primaryDeep: shift(p.accent, 0.3, "black"),
      accent: secondary,
      accentSoft: shift(secondary, 0.35, "white"),
      gold: tertiary,
      goldSoft: shift(tertiary, 0.4, "white"),
      safe: "#10B981",
      safeSoft: "#6EE7B7",
      caution: "#F97316",
      avoid: "#EF4444",
      ink: p.ink,
      inkSoft: shift(p.ink, 0.45, "white"),
      white: "#FFFFFF",
    },
    fonts: DEFAULT_THEME.fonts,
    screenRatio: DEFAULT_THEME.screenRatio,
  };
}
