import "dotenv/config";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { bin, run, chunkWords, buildRenderCommand, probeMedia } from "@distribution/media";
import { runCaptions, runTitleBar, restoreBrollText } from "../packages/pipelines/src/shorts/sidecars";
async function main() {
  const dir = path.resolve("storage/tmp/qa-title-band");
  await mkdir(dir, { recursive: true });
  const words = JSON.parse(await readFile("storage/tmp/qa-safechoice-broll/words.json", "utf8")).words;
  const cropped = path.join(dir, "cropped.mp4"), flat = path.join(dir, "flat.mp4"), titled = path.join(dir, "titled.mp4");
  await run(bin("ffmpeg"), ["-y", "-v", "error", "-i", "storage/projects/5b433aab-0520-4980-9aed-1e1a2343fa24/clips/981aae91-a73d-438a-b75b-e71aecfb212b/flat.mp4", "-t", "4", "-vf", "crop=1080:1000:0:300,scale=1080:1920", "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", cropped], { timeoutMs: 120000 });
  const colors = { highlightColor: "#17B26A", strokeColor: "#0D1114" };
  const captionPreset = "hormozi-pop";
  const track = await runCaptions({ width: 1080, height: 1920, duration: 4, style: captionPreset, chunks: chunkWords(words, 0, 4), colors, outDir: path.join(dir, "original-captions") });
  await run(bin("ffmpeg"), ["-v", "error", ...buildRenderCommand({ sourcePath: cropped, startSec: 0, endSec: 4, outputPath: flat, captionOverlay: track, hasVideo: true })], { timeoutMs: 120000 });
  await runTitleBar(flat, "Bagel has more sugar than muffin", titled, { artifactDirectory: dir, onLog: console.log });
  const layout = JSON.parse(await readFile(path.join(dir, "layout.json"), "utf8"));
  if (layout.bandPixels <= 0) throw new Error("Test did not exercise title band mode");
  // Reuse actual previously sourced stock scenes; no simulated/generated footage.
  const plan = JSON.parse(await readFile("storage/tmp/qa-safechoice-broll/edit_clip/scene_plan.json", "utf8"));
  plan.source = titled; plan.scenes = plan.scenes.filter((s: { end: number }) => s.end <= 4); plan.caption = { preserve: false };
  const edit = path.join(dir, "edit_titled"); await mkdir(edit, { recursive: true });
  const planPath = path.join(edit, "scene_plan.json"); await writeFile(planPath, JSON.stringify(plan));
  await run(bin("python"), ["vendor/b-rolls/scripts/render_timeline.py", planPath], { timeoutMs: 120000 });
  const raw = path.join(dir, "stock.mp4");
  await run(bin("ffmpeg"), ["-y", "-v", "error", "-i", path.join(edit, "animations/slot_rapid_timeline/render.mp4"), "-i", titled, "-map", "0:v", "-map", "1:a", "-c", "copy", raw], { timeoutMs: 120000 });
  const output = await restoreBrollText(titled, raw, { words, captionPreset, colors, titleOverlayPath: path.join(dir, "title.png"), captionOffsetY: layout.bandPixels });
  const probe = await probeMedia(output);
  if (!probe.hasAudio || !probe.hasVideo || Math.abs(probe.durationSec - 4) > 0.15) throw new Error("Invalid band regression output");
  await run(bin("ffmpeg"), ["-v", "error", "-i", output, "-f", "null", "-"], { timeoutMs: 120000 });
  await run(bin("ffmpeg"), ["-y", "-v", "error", "-ss", "1.5", "-i", output, "-frames:v", "1", path.join(dir, "restored-frame.png")], { timeoutMs: 120000 });
  console.log(JSON.stringify({ pass: true, band: layout.bandPixels, output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
