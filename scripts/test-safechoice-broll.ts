/** Real eight-second SafeChoice-source clip, real stock sourcing and budgeted planning. */
import "dotenv/config";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { assets, candidates, closeDb, eq, getDb, limits, productBudget, products, transcripts, usageLedger } from "@distribution/db";
import { bin, probeMedia, run } from "@distribution/media";
import { AnthropicProvider } from "../packages/providers/src/index";
import { getStorage } from "@distribution/storage";
import { runBroll, restoreBrollText, brollScenePlanPath } from "../packages/pipelines/src/shorts/sidecars";
import { loadProfile, paletteOf } from "../packages/pipelines/src/shorts/common";
import { rebaseWords } from "../packages/pipelines/src/shorts/enrich/steps";
import type { TranscriptWord } from "@distribution/core";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  const db = getDb();
  const candidate = (await db.select().from(candidates).where(eq(candidates.id, "981aae91-a73d-438a-b75b-e71aecfb212b")))[0]!;
  const parent = (await db.select().from(assets).where(eq(assets.candidateId, candidate.id))).find(a => a.type === "clip")!;
  const transcript = (await db.select().from(transcripts).where(eq(transcripts.id, candidate.transcriptId)))[0]!;
  const product = (await db.select().from(products).where(eq(products.id, parent.productId)))[0]!;
  // This QA product only: cap every paid request before it can execute.
  const limit = (await db.select().from(limits).where(eq(limits.scopeId, product.id))).find(l => l.key === "usd_month");
  if (!limit) await db.insert(limits).values({ id: randomUUID(), scope: "product", scopeId: product.id, key: "usd_month", value: 0.75 });
  const dir = path.resolve("storage/tmp/qa-safechoice-broll");
  await mkdir(dir, { recursive: true });
  const clip = path.join(dir, "clip.mp4"), output = path.join(dir, "broll.mp4"), wordsPath = path.join(dir, "words.json");
  await run(bin("ffmpeg"), ["-y", "-v", "error", "-i", await getStorage().localPathFor(parent.storageKey), "-t", "8", "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", clip], { timeoutMs: 120000 });
  const words = rebaseWords(transcript.words as TranscriptWord[], candidate.startSec, candidate.startSec + 8);
  if (!words.length) throw new Error("Actual transcript missing");
  await writeFile(wordsPath, JSON.stringify({ words }));
  const profile = await loadProfile(db, product.id);
  const palette = paletteOf(profile);
  const text = { words, captionPreset: String(parent.metadata.captions), title: String(parent.metadata.title), titleStroke: palette.ground, colors: profile.contentPreferences.captionUseBrandColors ? { highlightColor: palette.accent, strokeColor: palette.ground } : undefined };
  let final: string;
  let cost = 0;
  try {
    if (process.argv.includes("--restore-existing")) {
      // Reuse the real sourced timeline to verify text repair without buying another plan.
      await run(bin("ffmpeg"), ["-y", "-v", "error", "-i", path.join(dir, "edit_clip/animations/slot_rapid_timeline/render.mp4"), "-i", clip, "-map", "0:v", "-map", "1:a", "-c", "copy", output], { timeoutMs: 120000 });
      final = await restoreBrollText(clip, output, text, { onLog: console.log });
    } else final = await withProviderBudget(productBudget(db, product.id, randomUUID()), () => runBroll(clip, {
      text, topic: candidate.hook, transcriptJsonPath: wordsPath, output, peoplePolicy: "no-people", onLog: console.log,
      plan: async prompt => {
        const result = await new AnthropicProvider().chat({ messages: [{ role: "user", content: prompt }], maxTokens: 8000 }, process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001", {
          purpose: "broll_plan", recordUsage: async usage => { cost += usage.usdEstimate; await db.insert(usageLedger).values({ ...usage, productId: product.id, accountId: product.accountId }); },
        });
        return result.text;
      },
    }));
    const plan = JSON.parse(await readFile(brollScenePlanPath(clip), "utf8"));
    const stock = plan.scenes.filter((scene: { kind: string }) => scene.kind === "video");
    if (!stock.length) throw new Error("No real B-roll footage in result");
    const media = await probeMedia(final);
    if (!media.hasVideo || !media.hasAudio || Math.abs(media.durationSec - 8) > 0.2) throw new Error("Invalid output media");
    await run(bin("ffmpeg"), ["-v", "error", "-i", final, "-f", "null", "-"], { timeoutMs: 120000 });
    console.log(JSON.stringify({ pass: true, output: final, sourcedScenes: stock.length, duration: media.durationSec, cost }));
  } finally { console.log(JSON.stringify({ recordedProviderCost: cost })); await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
