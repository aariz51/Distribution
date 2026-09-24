import "dotenv/config";
import { searchYoutube, probeYoutube } from "@distribution/media";
import { writeFile } from "node:fs/promises";
async function main() {
  const signal = AbortSignal.timeout(12 * 60_000);
  const videos = await searchYoutube(process.argv[2] ?? "nutrition food labels lecture creative commons", signal);
  const candidates = [];
  for (const video of videos.slice(0, 12)) {
    try {
      const meta = await probeYoutube(video.url, signal);
      candidates.push({ ...video, license: meta.license, reuseAllowed: meta.reuseAllowed });
      console.log(JSON.stringify(candidates.at(-1)));
    } catch (error) { console.log(JSON.stringify({ url: video.url, error: error instanceof Error ? error.message : String(error) })); }
  }
  await writeFile(new URL("../storage/tmp/nutrition-source-license-research.json", import.meta.url), JSON.stringify(candidates, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
