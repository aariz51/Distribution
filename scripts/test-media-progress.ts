import "./_env";
import { bin, run } from "@distribution/media";
import { getStorage } from "@distribution/storage";
async function main() {
  const file = await getStorage().localPathFor("promo/9e0ce875-5236-4494-b179-b184ce3c660b/out/promo_vertical.mp4");
  const times: number[] = [], phases: string[] = [];
  await run(bin("ffmpeg"), ["-v", "error", "-xerror", "-nostats", "-progress", "pipe:2", "-i", file, "-f", "null", "-"], { timeoutMs: 120_000, onStderrLine: line => {
    if (line.startsWith("out_time_us=")) times.push(Number(line.slice(12)));
    if (line.startsWith("progress=")) phases.push(line.slice(9));
  } });
  if (!times.length || times.some((time, i) => !Number.isFinite(time) || (i > 0 && time < times[i - 1]!)) || times.at(-1)! < 17_900_000 || phases.at(-1) !== "end") throw new Error("Real FFmpeg progress coverage failed");
  console.log(`PASS: actual SafeChoice decode emitted ${times.length} complete monotonic progress records through ${times.at(-1)! / 1_000_000}s and progress=end`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
