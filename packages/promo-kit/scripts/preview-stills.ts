/**
 * Render stills of a storyboard at chosen frames — SKILL.md step 8 ("render
 * stills at every beat, in every orientation you ship, and read them").
 *
 *   tsx scripts/preview-stills.ts <storyboard.json> <publicDir> <outDir> [composition] [frames,comma,sep] [--no-cube]
 *
 * storyboard.json holds { storyboard, theme } (the pipeline's stored form).
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderPromoStill, type CompositionId } from "../src/render";

async function main() {
  const [sbPath, publicDir, outDir, comp = "PromoVertical", framesArg, flag] = process.argv.slice(2);
  if (!sbPath || !publicDir || !outDir) throw new Error("usage: preview-stills.ts <storyboard.json> <publicDir> <outDir> [composition] [frames] [--no-cube]");
  const { storyboard, theme } = JSON.parse(await readFile(sbPath, "utf8"));
  const frames = framesArg
    ? framesArg.split(",").map(Number)
    : storyboard.scenes.flatMap((s: { start: number; duration: number }) => [s.start + Math.round(s.duration * 0.35), s.start + Math.round(s.duration * 0.85)]);
  await mkdir(outDir, { recursive: true });
  for (const frame of frames) {
    const out = path.join(outDir, `${comp}-${String(frame).padStart(4, "0")}${flag === "--no-cube" ? "-nocube" : ""}.png`);
    await renderPromoStill({ compositionId: comp as CompositionId, storyboard, theme, publicDir, outPath: out, frame, ...(flag === "--no-cube" ? { cube: false } : {}) });
    console.log(out);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
