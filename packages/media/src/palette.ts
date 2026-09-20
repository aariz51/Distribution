import sharp from "sharp";

export interface PaletteResult {
  ink: string;
  accent: string;
  canvas: string;
  ground: string;
  extra: string[];
  /** every cluster, most frequent first, for the UI to show swatches */
  clusters: { hex: string; share: number }[];
}

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return max === 0 ? 0 : (max - min) / max;
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Deterministic k-means (fixed seeds spread by luminance) over downscaled pixels. */
export function kmeans(pixels: Rgb[], k: number, iterations = 12): { center: Rgb; count: number }[] {
  if (pixels.length === 0) return [];
  const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b));
  let centers: Rgb[] = Array.from({ length: k }, (_, i) => {
    const p = sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!;
    return [p[0], p[1], p[2]];
  });
  const assign = new Array<number>(pixels.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(pixels[i]!, centers[c]!);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assign[i]!]!;
      const p = pixels[i]!;
      s[0]! += p[0];
      s[1]! += p[1];
      s[2]! += p[2];
      s[3]! += 1;
    }
    centers = sums.map((s, c) => (s[3] ? [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] : centers[c]!));
  }
  const counts = centers.map(() => 0);
  for (const a of assign) counts[a]!++;
  return centers.map((center, i) => ({ center, count: counts[i]! })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
}

async function samplePixels(buf: Buffer, size: number): Promise<Rgb[]> {
  const { data, info } = await sharp(buf).resize(size, size, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px: Rgb[] = [];
  for (let i = 0; i < data.length; i += info.channels) {
    px.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  return px;
}

/**
 * Infer a practical brand palette from a logo and screenshots.
 * Roles follow the `creative.py` / promo theme contract: `canvas` (light paper),
 * `ground` (dark ground), `ink` (text on canvas), `accent` (the brand hue).
 * Logo pixels are weighted 3x so the brand hue wins over UI chrome.
 */
export async function inferPalette(images: { buffer: Buffer; role: "logo" | "screenshot" | "other" }[]): Promise<PaletteResult> {
  const pixels: Rgb[] = [];
  for (const img of images) {
    const px = await samplePixels(img.buffer, img.role === "logo" ? 96 : 72);
    const weight = img.role === "logo" ? 3 : 1;
    for (let w = 0; w < weight; w++) pixels.push(...px);
  }
  const clusters = kmeans(pixels, 8);
  const total = clusters.reduce((s, c) => s + c.count, 0) || 1;
  const list = clusters.map((c) => ({ rgb: c.center, share: c.count / total }));

  const light = list.filter((c) => luminance(c.rgb) > 0.6);
  const dark = list.filter((c) => luminance(c.rgb) < 0.12);
  const canvasC = (light.sort((a, b) => b.share - a.share)[0] ?? { rgb: [246, 245, 241] as Rgb }).rgb;
  const groundC = (dark.sort((a, b) => b.share - a.share)[0] ?? { rgb: [13, 17, 20] as Rgb }).rgb;
  const colourful = list
    .filter((c) => saturation(c.rgb) > 0.35 && luminance(c.rgb) > 0.015 && luminance(c.rgb) < 0.85)
    .sort((a, b) => b.share * (0.5 + saturation(b.rgb)) - a.share * (0.5 + saturation(a.rgb)));
  const accentC = (colourful[0] ?? { rgb: [23, 178, 106] as Rgb }).rgb;
  const inkCandidates = list.filter((c) => contrast(c.rgb, canvasC) >= 4.5).sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
  const inkC = (inkCandidates[0] ?? { rgb: [20, 23, 26] as Rgb }).rgb;
  // Roles must be distinct: with no near-black cluster the accent would also win
  // ground and ink. Derive darker variants of the accent instead (same hue family).
  const mix = (c: Rgb, t: number, towards: Rgb = [0, 0, 0]): Rgb => [
    c[0] + (towards[0] - c[0]) * t,
    c[1] + (towards[1] - c[1]) * t,
    c[2] + (towards[2] - c[2]) * t,
  ];
  let groundOut = groundC;
  let inkOut = inkC;
  if (hex(groundOut) === hex(accentC)) groundOut = mix(accentC, 0.72);
  if (hex(inkOut) === hex(accentC) || hex(inkOut) === hex(groundOut)) inkOut = mix(accentC, 0.85);
  if (contrast(inkOut, canvasC) < 4.5) inkOut = [20, 23, 26];
  const chosen = new Set([hex(canvasC), hex(groundOut), hex(accentC), hex(inkOut)]);
  const extra = colourful.slice(1).map((c) => hex(c.rgb)).filter((h) => !chosen.has(h)).slice(0, 4);

  return {
    ink: hex(inkOut),
    accent: hex(accentC),
    canvas: hex(canvasC),
    ground: hex(groundOut),
    extra,
    clusters: list.map((c) => ({ hex: hex(c.rgb), share: Math.round(c.share * 1000) / 1000 })),
  };
}
