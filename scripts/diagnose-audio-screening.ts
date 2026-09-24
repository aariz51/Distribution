/** Actual source audio diagnosis; no source approval or screening report is changed. */
import "./_env";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { closeDb, eq, getDb, products, usageLedger } from "@distribution/db";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { bin, run } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { reviewAudioSample } from "./lib/audio-review-diagnostic";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  const product = (await db.select().from(products).where(eq(products.id, productId)))[0]!;
  const dir = path.resolve(import.meta.dirname, "../storage/tmp/audio-semantic-diagnostic");
  await mkdir(dir, { recursive: true });
  const fats = "products/3fe71fcc-3101-432d-a1ec-583d785592a4/sources/85fcadb4-ab2b-4c68-8623-09ac149626d9/original.mp4";
  const controls = process.argv.includes("--controls");
  const samples = controls ? [
    { name: "safechoice-preview-music", key: "/Users/aarizazizrasheed/Downloads/SafeChoice-AppPreview-886x1920.mp4", start: 20, seconds: 7, channel: 0 },
    { name: "safechoice-preview-music-right", key: "/Users/aarizazizrasheed/Downloads/SafeChoice-AppPreview-886x1920.mp4", start: 20, seconds: 7, channel: 1 },
  ] : [
    { name: "fats-peak-left", key: fats, start: 222, seconds: 12, channel: 0 },
    { name: "fats-peak-right", key: fats, start: 222, seconds: 12, channel: 1 },
    { name: "fats-baseline", key: fats, start: 10, seconds: 8, channel: 0 },
    { name: "bbc-intro", key: "products/6cc41ef3-7761-4520-b843-361ce1b8bca7/sources/c806bbdb-fcd5-4fa6-bdf3-0d1a65238c0e/original.mp4", start: 0, seconds: 8, channel: 0 },
  ];
  let reserved = 0, actualUsd = 0;
  const results = [];
  for (const sample of samples) {
    const file = path.join(dir, `${sample.name}.wav`);
    await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", String(sample.start), "-i", path.isAbsolute(sample.key) ? sample.key : await getStorage().localPathFor(sample.key), "-t", String(sample.seconds), "-map", "0:a:0", "-vn", "-af", `pan=mono|c0=c${sample.channel}`, "-ar", "16000", "-c:a", "pcm_s16le", file], { timeoutMs: 30_000 });
    const review = await withProviderBudget({ run: async (estimate, work) => { reserved += estimate; if (reserved > .1) throw new Error("Audio diagnostic budget cap exceeded"); return work(); } }, () => reviewAudioSample(file, { recordUsage: async usage => {
      actualUsd += usage.usdEstimate;
      await db.insert(usageLedger).values({ accountId: product.accountId, productId, ...usage, purpose: "audio_screening_diagnostic" });
    } }));
    results.push({ ...sample, review });
    await writeFile(path.join(dir, controls ? "controls.json" : "report.json"), JSON.stringify({ diagnosticOnly: true, approvalChanged: false, actualUsd, results }, null, 2));
    console.log(JSON.stringify({ sample: sample.name, ...review }));
  }
  console.log(`Actual provider reported cost: $${actualUsd.toFixed(6)}`);
}
main().finally(closeDb).catch(error => { console.error(error.message); process.exitCode = 1; });
