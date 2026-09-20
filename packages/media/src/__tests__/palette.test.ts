import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inferPalette, kmeans } from "../palette";

async function solid(r: number, g: number, b: number, w = 40, h = 40) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

describe("palette", () => {
  it("kmeans finds the two dominant colours", () => {
    const px: [number, number, number][] = [];
    for (let i = 0; i < 100; i++) px.push([250, 250, 250]);
    for (let i = 0; i < 50; i++) px.push([20, 60, 200]);
    const c = kmeans(px, 2);
    expect(c[0]!.count).toBe(100);
    expect(Math.round(c[1]!.center[2]!)).toBe(200);
  });

  it("assigns roles from logo + screenshot", async () => {
    const logo = await solid(27, 58, 107); // navy
    const screen = await sharp({
      create: { width: 60, height: 60, channels: 3, background: { r: 246, g: 245, b: 241 } },
    })
      .composite([{ input: await solid(20, 23, 26, 20, 20), top: 5, left: 5 }])
      .png()
      .toBuffer();
    const p = await inferPalette([
      { buffer: logo, role: "logo" },
      { buffer: screen, role: "screenshot" },
    ]);
    expect(p.canvas.toLowerCase()).toBe("#f6f5f1");
    expect(p.accent.toLowerCase()).toBe("#1b3a6b");
    expect(p.clusters.length).toBeGreaterThan(1);
    expect(new Set([p.ink, p.accent, p.canvas, p.ground]).size).toBe(4);
  });
});
