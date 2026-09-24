import "dotenv/config";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { bin, probeMedia, run } from "@distribution/media";
import { validateEnrichedMedia } from "../packages/pipelines/src/shorts/enrich/validate";

async function main() {
  const input = path.resolve("storage/tmp/qa-safechoice-broll/broll-text/restored.mp4");
  const good = path.resolve("storage/projects/f9137449-d3ca-4cbb-9dc1-23b0acea81d9/clips/7401bb58-464e-4bbf-bbe7-294ddff2b5fb/enriched.mp4");
  const scratch = await mkdtemp(path.join(os.tmpdir(), "verify-export-"));
  try {
    await validateEnrichedMedia(good, input, true);
    for (const [name, args] of [
      ["missing-audio", ["-an", "-c:v", "copy"]],
      ["shortened", ["-t", "2", "-c", "copy"]],
      ["wrong-dimensions", ["-vf", "scale=270:480", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "copy"]],
    ] as const) {
      const output = path.join(scratch, `${name}.mp4`);
      await run(bin("ffmpeg"), ["-v", "error", "-y", "-i", input, ...args, output], { timeoutMs: 60000 });
      let rejected = false;
      try { await validateEnrichedMedia(output, input, false); } catch { rejected = true; }
      if (!rejected) throw new Error(`Accepted ${name}`);
      console.log(`PASS: rejected ${name}`);
    }
    const damaged = path.join(scratch, "damaged.mp4");
    const bytes = await readFile(good);
    // Preserve the MP4 header/metadata but damage media packets in the middle.
    bytes.fill(0xff, Math.floor(bytes.length * .4), Math.floor(bytes.length * .6));
    await writeFile(damaged, bytes);
    const damagedProbe = await probeMedia(damaged);
    const goodProbe = await probeMedia(good);
    if (damagedProbe.durationSec !== goodProbe.durationSec || !damagedProbe.hasAudio || !damagedProbe.hasVideo) throw new Error("Corruption fixture must preserve valid metadata");
    let rejected = false;
    try { await validateEnrichedMedia(damaged, input, true); } catch { rejected = true; }
    if (!rejected) throw new Error("Accepted damaged media");
    console.log("PASS: rejected damaged packets; actual SafeChoice export passed full decode");
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
