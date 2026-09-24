/** Render real SafeChoice promo covers using the production compositor. */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "@distribution/db";
import { bin, run } from "@distribution/media";
import sharp from "sharp";
import { loadProfile } from "../packages/pipelines/src/shorts/common";
import { renderBrandedThumbnail } from "../packages/pipelines/src/thumbnail-render";
async function main() {
  const db = getDb(), signal = AbortSignal.timeout(120000);
  try {
    const productId = "6cc41ef3-7761-4520-b843-361ce1b8bca7";
    const profile = await loadProfile(db, productId);
    const dir = fileURLToPath(new URL("../storage/tmp/branded-promo-covers/", import.meta.url));
    await mkdir(dir, { recursive: true });
    const variants = [
      { size: [1080,1920], type: "promo_vertical" },
      { size: [1920,1080], type: "promo_landscape" },
      { size: [886,1920], type: "promo_store_portrait" },
      { size: [1920,886], type: "promo_store_landscape" },
    ];
    for (const variant of variants) {
      const size = variant.size as [number, number];
      const video = fileURLToPath(new URL(`../storage/promo/87a4532a-92e7-4408-a6cc-18079b5d948a/out/${variant.type}.mp4`, import.meta.url));
      const frame = `${dir}${variant.type}-frame.png`;
      await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", "8", "-i", video, "-frames:v", "1", frame], { signal });
      const out = `${dir}${size.join("x")}.png`;
      await renderBrandedThumbnail({ db, profile, frame, headline: profile.product.tagline, size, out, signal });
      const meta = await sharp(out).metadata();
      if (meta.width !== size[0] || meta.height !== size[1] || meta.hasAlpha) throw new Error(`Invalid dimensions/RGB: ${out}`);
      console.log(`RENDERED ${out}`);
    }
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
