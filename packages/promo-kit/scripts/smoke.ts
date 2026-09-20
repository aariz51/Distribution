/** Local render smoke test: no API key, no network beyond the bundled Chromium. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demoStoryboard, renderPromo, renderPromoStill } from "../src/render";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const out = path.join(here, "..", "out");

async function main() {
  const sb = demoStoryboard(1080, 1920);
  const which = process.argv[2] ?? "still";
  if (which === "still") {
    const frames = [40, 260, 380, 520, 760, 980, 1260, 1560, 1800, 1950];
    for (const f of frames) {
      await renderPromoStill({ storyboard: sb, compositionId: "PromoVertical", frame: f, outPath: path.join(out, `still-${f}.png`), publicDir });
      console.log("still", f);
    }
  } else {
    const t = Date.now();
    const res = await renderPromo({
      storyboard: sb,
      compositionId: "PromoVertical",
      outPath: path.join(out, "smoke.mp4"),
      publicDir,
      frameRange: [0, 89],
      onProgress: (p) => process.stdout.write(`\r${p}%`),
    });
    console.log(`\ndone in ${((Date.now() - t) / 1000).toFixed(1)}s`, res);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
