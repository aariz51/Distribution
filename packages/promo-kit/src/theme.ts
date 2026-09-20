// Theme plumbing: a React context so every component derives colour from the
// storyboard's theme instead of a hardcoded palette. `alpha()` replaces the
// template's rgba literals.
import React, { createContext, useContext } from "react";
import { DEFAULT_THEME, type Theme } from "./schema";

export const ThemeContext: React.Context<Theme> = createContext<Theme>(DEFAULT_THEME);
export const useTheme = (): Theme => useContext(ThemeContext);

/** "#RRGGBB" + alpha 0..1 → "rgba(r,g,b,a)". */
export function alpha(hexColor: string, a: number): string {
  const h = hexColor.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export const fontHead = (t: Theme) => `"${t.fonts.head}", system-ui, "Segoe UI", sans-serif`;
export const fontBody = (t: Theme) => `"${t.fonts.body}", system-ui, "Segoe UI", sans-serif`;
export const fontMono = (t: Theme) => t.fonts.mono;

/** Soft radial background used across light scenes. */
export const bgRadial = (t: Theme) =>
  `radial-gradient(circle at 50% 38%, ${t.colors.white} 0%, ${t.colors.cream} 42%, ${t.colors.creamDeep} 100%)`;

/** Dark ground for inverted scenes. */
export const bgDark = (t: Theme) =>
  `radial-gradient(circle at 50% 38%, ${alpha(t.colors.primaryDeep, 0.35)} 0%, ${t.colors.ink} 55%, #0B0C12 100%)`;
