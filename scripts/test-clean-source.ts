import "dotenv/config";
import path from "node:path";
import { bin, probeMedia, run } from "@distribution/media";
async function main() {
  const voice = process.argv.includes("--voice");
  const output = path.resolve("storage/tmp/qa-clean-source-output.mp4");
  await run(bin("python"), [path.resolve("vendor/autoshorts-py/assets/clean_source.py"), "--video", path.resolve("storage/tmp/qa-clean-source-input.mp4"), "--output", output, ...(voice ? [] : ["--no-audio-clean"])], { timeoutMs: 300_000 });
  const probe = await probeMedia(output);
  if (!probe.hasAudio || !probe.hasVideo || Math.abs(probe.durationSec - 4) > 0.2) throw new Error("Invalid cleaned media");
  await run(bin("ffmpeg"), ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], { timeoutMs: 60_000 });
  console.log(`PASS: actual SafeChoice source excerpt cleaned with caption inspection and full decode; voice isolation ${voice ? "included" : "excluded"}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
