/** Render the repaired director with the real stored SafeChoice assets, without changing jobs. */
import "./_env";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { closeDb, getDb, loadProductProfile } from "@distribution/db";
import { buildStoryboard, themeForProduct } from "@distribution/pipelines";
import { assertDiskSpace, GB, probeMedia, run, bin } from "@distribution/media";
import { renderPromo } from "../packages/promo-kit/src/render";

async function main() {
  const productId = process.argv[2];
  const publicDir = process.argv[3];
  if (!productId || !publicDir) throw new Error("Usage: verify-safechoice-render.ts <productId> <existing-publicDir>");
  const profile = await loadProductProfile(getDb(), productId);
  if (!profile || profile.product.name !== "SafeChoice") throw new Error("Expected the real SafeChoice product");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(path.join(publicDir, "app-screens"))).filter(name => /\.(png|jpe?g|webp)$/i.test(name)).sort();
  if (!files.length) throw new Error("SafeChoice screenshots missing");
  const screens = Object.fromEntries(files.map((file, i) => [`screen${i + 1}`, `app-screens/${file}`]));
  const built = buildStoryboard({ profile, screens, logo: "logo/app-logo.png", durationSec: 18, structure: { id: "copy-qa", rationale: "Exercise full real product copy", beats: [{ kind: "hook", weight: 1 }, { kind: "features", weight: 2 }, { kind: "dashboard", weight: 2 }, { kind: "logo", weight: 1 }] } });
  if (built.storyboard.scenes.some(scene => "score" in scene.copy)) throw new Error("Director fabricated a score");
  const outputDir = path.resolve("storage/tmp/qa-safechoice-copy");
  await mkdir(outputDir, { recursive: true });
  await assertDiskSpace(outputDir, 2 * GB, "verification");
  const fx = path.join(outputDir, "fx.json");
  await writeFile(fx, JSON.stringify(built.storyboard.sfx));
  // Keep generated sound alongside this verification's own staged assets.
  const staged = path.join(outputDir, "public");
  const { cp } = await import("node:fs/promises");
  await cp(publicDir, staged, { recursive: true });
  await run(bin("python"), [path.resolve("packages/promo-kit/scripts/build_audio.py"), "--duration", "18", "--fx", fx, "--out", path.join(staged, "audio/master.wav"), "--sfx-dir", path.join(staged, "sfx")], { timeoutMs: 120_000 });
  built.storyboard.audioSrc = "audio/master.wav";
  for (const compositionId of ["PromoVertical", "PromoLandscape"] as const) {
  const outPath = path.join(outputDir, `${compositionId}.mp4`);
  let last = -10;
  await renderPromo({ storyboard: built.storyboard, theme: themeForProduct(profile), compositionId, publicDir: staged, outPath, concurrency: 1, onProgress: pct => {
    if (pct >= last + 10) { console.log(`Rendering ${pct}%`); last = pct; }
  }});
  const probe = await probeMedia(outPath);
  if (probe.width !== (compositionId === "PromoVertical" ? 1080 : 1920) || probe.height !== (compositionId === "PromoVertical" ? 1920 : 1080) || !probe.hasAudio || Math.abs(probe.durationSec - 18) > 0.15) throw new Error("Output media contract failed");
  await run(bin("ffmpeg"), ["-v", "error", "-xerror", "-i", outPath, "-f", "null", "-"], { timeoutMs: 120_000 });
  const proof = built.storyboard.scenes.find(scene => scene.kind === "features")!;
  const framePath = path.join(outputDir, `${compositionId}-features.png`);
  await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", String((proof.start + proof.duration / 2) / built.storyboard.fps), "-i", outPath, "-frames:v", "1", framePath], { timeoutMs: 60_000 });
  const report = { productId, screenshots: files.length, outPath, framePath, probe, scenes: built.storyboard.scenes, decoded: true };
  await writeFile(path.join(outputDir, `${compositionId}-verification.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outPath, framePath, probe, decoded: true }));
  }
}
main().finally(closeDb).catch(error => { console.error(error.message); process.exitCode = 1; });
