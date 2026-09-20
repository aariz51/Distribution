import path from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { PipelineError, newId, type TranscriptWord } from "@distribution/core";
import { assets, candidates, eq, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { probeMedia } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, withScratch } from "../common";
import { NO_TTS_PYTHON, SILENT_OUTRO_LINE, brollScenePlanPath, ensureSfxKit, runBroll, runOutro, runSfxMix } from "../sidecars";
import { orderSteps, rebaseWords, type EnrichStep } from "./steps";

/**
 * shorts.enrich — the AutoShorts enrichment chain as a job: B-roll → sound design →
 * branded end card, each step soft-failing (warn event, carry the previous file on)
 * exactly as `lib.rs:777-821` did. Output is a new `clip_enriched` asset derived from
 * the clip; the parent clip and its copy rows are left untouched.
 */
export async function shortsEnrich(ctx: JobContext<"shorts.enrich">) {
  const { productId, projectId, assetId } = ctx.payload;
  const steps = orderSteps(ctx.payload.steps);
  const db = ctx.db;
  const storage = getStorage();

  const parent = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!parent) throw new PipelineError("asset not found", { step: "load" });
  if (parent.type !== "clip") throw new PipelineError(`asset is ${parent.type}, expected clip`, { step: "load" });
  if (!parent.candidateId) throw new PipelineError("clip has no candidate", { step: "load" });
  const candidateId = parent.candidateId;
  const cand = (await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1))[0];
  if (!cand) throw new PipelineError("candidate not found", { step: "load" });
  const tr = (await db.select().from(transcripts).where(eq(transcripts.id, cand.transcriptId)).limit(1))[0];
  const profile = await loadProfile(db, productId);
  const prefs = profile.contentPreferences;
  const clipWords = tr ? rebaseWords(tr.words as TranscriptWord[], cand.startSec, cand.endSec) : [];

  const logoRow = profile.brand.logoAssetId ? (await db.select({ key: assets.storageKey }).from(assets).where(eq(assets.id, profile.brand.logoAssetId)).limit(1))[0] : undefined;
  const logoPath = logoRow ? await storage.localPathFor(logoRow.key) : undefined;

  const result = await withScratch("enrich", async (scratch) => {
    // Work on a copy: broll_pipeline.py writes `edit_<stem>/` beside its input.
    const clip = path.join(scratch, "clip.mp4");
    await copyFile(await storage.localPathFor(parent.storageKey), clip);
    let transcriptJson: string | undefined;
    if (clipWords.length) {
      transcriptJson = path.join(scratch, "transcript.json");
      await writeFile(transcriptJson, JSON.stringify({ words: clipWords }));
    }

    const applied: EnrichStep[] = [];
    const skipped: Record<string, string> = {};
    let current = clip;
    const soft = async (step: EnrichStep, fn: () => Promise<string>) => {
      try {
        current = await fn();
        applied.push(step);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped[step] = msg;
        await ctx.event("warn", `${step} skipped: ${msg}`, undefined, step);
      }
    };
    const log = (step: string) => (l: string) => void ctx.event("debug", l, undefined, step);

    if (steps.includes("broll")) {
      await ctx.progress(30, "broll", "Sourcing B-roll");
      await soft("broll", () => runBroll(current, { topic: cand.hook, transcriptJsonPath: transcriptJson, output: path.join(scratch, "clip_broll.mp4"), peoplePolicy: prefs.peoplePolicy, signal: ctx.signal, onLog: log("broll") }));
    }

    if (steps.includes("sfx")) {
      await ctx.progress(70, "sfx", "Mixing sound design");
      await soft("sfx", async () => {
        const kit = await ensureSfxKit(path.dirname(await storage.localPathFor("tmp/sfx-kit/riser.wav")), { signal: ctx.signal, onLog: log("sfx") });
        const kits = [kit, ...(process.env.SFX_EXTRA_KIT_DIR ? [process.env.SFX_EXTRA_KIT_DIR] : [])];
        const scenes = applied.includes("broll") ? brollScenePlanPath(clip) : undefined;
        return runSfxMix(current, kits, path.join(scratch, "clip_sfx.mp4"), { transcriptJson, scenes, signal: ctx.signal, onLog: log("sfx") });
      });
    }

    if (steps.includes("outro")) {
      await ctx.progress(85, "outro", "Rendering end card");
      await soft("outro", async () => {
        const appName = profile.product.name.trim();
        if (!appName) throw new PipelineError("product has no name for the end card", { step: "outro" });
        const clone = prefs.voice === "clone";
        return runOutro(current, appName, path.join(scratch, "clip_final.mp4"), {
          logo: logoPath,
          transcriptJson: clone ? transcriptJson : undefined,
          ttsPython: clone ? process.env.TTS_PYTHON_BIN || NO_TTS_PYTHON : NO_TTS_PYTHON,
          line: clone ? undefined : SILENT_OUTRO_LINE,
          signal: ctx.signal,
          onLog: log("outro"),
        });
      });
    }

    if (!applied.length) throw new PipelineError(`no enrichment step succeeded: ${JSON.stringify(skipped)}`, { step: "enrich" });

    await ctx.progress(95, "store", "storing enriched clip");
    const key = keys.clip(projectId, candidateId, "enriched");
    await storage.putFile(key, current, { contentType: "video/mp4" });
    const out = await probeMedia(await storage.localPathFor(key), { signal: ctx.signal });
    const id = newId();
    await db.insert(assets).values({
      id,
      productId,
      projectId,
      type: "clip_enriched",
      sourceId: parent.sourceId,
      candidateId,
      derivedFromAssetId: parent.id,
      storageKey: key,
      mimeType: "video/mp4",
      width: out.width,
      height: out.height,
      durationSec: out.durationSec,
      sizeBytes: out.sizeBytes,
      thumbnailAssetId: parent.thumbnailAssetId,
      status: "review",
      approvalState: "pending",
      profileVersion: profile.version,
      jobId: ctx.jobId,
      metadata: { ...(parent.metadata as Record<string, unknown>), steps: applied, requestedSteps: steps, skipped, voice: steps.includes("outro") ? prefs.voice : undefined, peoplePolicy: steps.includes("broll") ? prefs.peoplePolicy : undefined, derivedFrom: parent.id },
    });
    return { assetId: id, key, steps: applied, skipped };
  });

  await ctx.progress(100, "done", "enriched clip in review");
  return result;
}
