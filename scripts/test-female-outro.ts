import "dotenv/config";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { closeDb, eq, getDb, products, productBudget, usageLedger } from "@distribution/db";
import { femaleOutroSpeech } from "../packages/providers/src/tts";
import { runOutro } from "../packages/pipelines/src/shorts/sidecars";
import { probeMedia, bin, run } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { assets } from "@distribution/db";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  try {
    const product = (await db.select().from(products).where(eq(products.id, productId)))[0]!;
    const logo = typeof product.brand.logoAssetId === "string" ? (await db.select().from(assets).where(eq(assets.id, product.brand.logoAssetId)))[0] : undefined;
    const audio = path.resolve("storage/tmp/qa-safechoice-broll/female-voice.mp3");
    let cost = 0;
    await withProviderBudget(productBudget(db, productId, randomUUID()), () => femaleOutroSpeech("Download Safe Choice", audio, { recordUsage: async usage => {
      cost += usage.usdEstimate;
      await db.insert(usageLedger).values({ ...usage, productId, accountId: product.accountId });
    } }));
    const output = path.resolve("storage/tmp/qa-safechoice-broll/female-outro.mp4");
    await runOutro(path.resolve("storage/tmp/qa-safechoice-broll/clip.mp4"), "SafeChoice", output, { voice: "female", voiceAudioPath: audio, logo: logo ? await getStorage().localPathFor(logo.storageKey) : undefined, onLog: console.log });
    const media = await probeMedia(output);
    if (!media.hasAudio || !media.hasVideo || media.durationSec <= 8 || media.durationSec > 15.2) throw new Error("Invalid generated outro");
    await run(bin("ffmpeg"), ["-v", "error", "-i", output, "-f", "null", "-"], { timeoutMs: 120000 });
    console.log(JSON.stringify({ pass: true, output, audio, duration: media.durationSec, estimatedCost: cost }));
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
