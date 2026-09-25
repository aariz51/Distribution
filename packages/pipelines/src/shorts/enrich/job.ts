import { screenOriginal, screenFinalClip } from "../screening";
import { validateEnrichedMedia } from "./validate";
import { AnthropicProvider, femaleOutroSpeech } from "@distribution/providers";
import { saveGeneratedAsset } from "../../generated-assets";
import { reconcileShortsProject } from "../completion";
import os from "node:os";
import path from "node:path";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { PipelineError, newId, type TranscriptWord } from "@distribution/core";
import { and, assets, candidates, eq, sourceVideos, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { GB, assertDiskSpace } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { loadProfile, withScratch } from "../common";
import { brollScenePlanPath, ensureSfxKit, runBroll, runOutro, runSfxMix } from "../sidecars";
import { orderSteps, rebaseWords, type EnrichStep } from "./steps";
import { sfxRecoveryWindows, type EffectPlacement } from "./sfx-recovery";

/**
 * shorts.enrich — the AutoShorts enrichment chain as a job: B-roll → sound design →
 * branded end card. Requested steps must succeed. Output is a new `clip_enriched` asset derived from
 * the clip; the parent clip and its copy rows are left untouched.
 */
export async function shortsEnrich(ctx: JobContext<"shorts.enrich">) {
  const { productId, projectId, assetId } = ctx.payload;
  const steps = orderSteps(ctx.payload.steps);
  const db = ctx.db;
  const storage = getStorage();

  const parent = (await db.select().from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!parent) throw new PipelineError("asset not found", { step: "load" });
  if (parent.productId !== productId || parent.projectId !== projectId) throw new PipelineError("Clip does not belong to this product and project", { step: "load" });
  if (parent.type !== "clip") throw new PipelineError(`asset is ${parent.type}, expected clip`, { step: "load" });
  if (!parent.candidateId) throw new PipelineError("clip has no candidate", { step: "load" });
  const candidateId = parent.candidateId;
  const cand = (await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1))[0];
  if (!cand || cand.projectId !== projectId) throw new PipelineError("Candidate does not belong to this project", { step: "load" });
  const tr = (await db.select().from(transcripts).where(eq(transcripts.id, cand.transcriptId)).limit(1))[0];
  const source = tr ? (await db.select().from(sourceVideos).where(eq(sourceVideos.id, tr.sourceId)).limit(1))[0] : undefined;
  if (!source || source.productId !== productId || parent.sourceId !== source.id) throw new PipelineError("Transcript/source does not belong to this clip", { step: "load" });
  if (!source.storageKey) throw new PipelineError("Original source missing", { step: "screening" });
  await screenOriginal(ctx, source.id, typeof source.probe?.originalStorageKey === "string" ? source.probe.originalStorageKey : source.storageKey);
  const profile = await loadProfile(db, productId, projectId);
  const prefs = profile.contentPreferences;
  const effectivePeoplePolicy = prefs.peoplePolicy === "no-people" ? "no-people" : "no-women";
  const clipWords = tr ? rebaseWords(tr.words as TranscriptWord[], cand.startSec, cand.endSec) : [];

  const logoRow = profile.brand.logoAssetId ? (await db.select({ key: assets.storageKey }).from(assets).where(and(eq(assets.id, profile.brand.logoAssetId), eq(assets.productId, productId))).limit(1))[0] : undefined;
  if (steps.includes("outro") && profile.brand.logoAssetId && !logoRow) throw new PipelineError("Configured logo is missing or belongs to another product", { step: "load" });
  const logoPath = logoRow ? await storage.localPathFor(logoRow.key) : undefined;

  // B-roll, sound mixing and the end card each write a full copy of the clip,
  // so enrichment needs several times the clip's own size. Check before the
  // first encode rather than failing on the last copy.
  const parentSize = parent.sizeBytes ?? 200 * 1024 * 1024;
  await assertDiskSpace(process.env.SCRATCH_ROOT ?? os.tmpdir(), Math.max(1 * GB, parentSize * 6), "enrich");

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
    const applyStep = async (step: EnrichStep, fn: () => Promise<string>) => {
      ctx.signal.throwIfAborted();
      current = await fn();
      applied.push(step);
    };
    const log = (step: string) => (l: string) => void ctx.event("debug", l, undefined, step);

    if (steps.includes("broll")) {
      await ctx.progress(30, "broll", "Sourcing B-roll");
      const snapshot = parent.metadata.textSnapshot as { version?: number; captionPreset?: string; colors?: { highlightColor?: string; strokeColor?: string }; titleOverlayKey?: string; titleBandPixels?: number } | undefined;
      if (!snapshot || snapshot.version !== 1) throw new PipelineError("This clip predates saved text layouts. Start a new run from its source before adding B-roll to preserve its captions and title.", { step: "broll" });
      const titleOverlayPath = snapshot.titleOverlayKey ? await storage.localPathFor(snapshot.titleOverlayKey) : undefined;
      await applyStep("broll", () => runBroll(current, { topic: cand.hook, validateComposite: file => screenFinalClip(ctx, file), text: {
        words: clipWords, captionPreset: snapshot.captionPreset ?? undefined,
        colors: snapshot.colors ?? undefined, titleOverlayPath, captionOffsetY: snapshot.titleBandPixels ?? 0,
      }, plan: async prompt => {
        const response = await new AnthropicProvider().chat({ messages: [{ role: "user", content: prompt }], maxTokens: 8000 }, process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929", {
          purpose: "broll_plan", signal: ctx.signal, log: ctx.log,
          recordUsage: u => ctx.recordUsage({ ...u, accountId: profile.accountId, productId }),
        });
        return response.text;
      }, transcriptJsonPath: transcriptJson, output: path.join(scratch, "clip_broll.mp4"), peoplePolicy: effectivePeoplePolicy, signal: ctx.signal, onLog: log("broll") }));
    }

    // Sound effects and the end card are rendered together as the tail. If the
    // finished clip is blocked only because an effect reads as music, the tail
    // is rebuilt from the same picture without that effect and screened again.
    const beforeTail = current;
    const headApplied = [...applied];
    let exclude: Array<[number, number]> = [];
    let placements: EffectPlacement[] = [];
    const kits = steps.includes("sfx") ? [await ensureSfxKit(path.dirname(await storage.localPathFor("tmp/sfx-kit/riser.wav")), { signal: ctx.signal, onLog: log("sfx") }), ...(process.env.SFX_EXTRA_KIT_DIR ? [process.env.SFX_EXTRA_KIT_DIR] : [])] : [];
    const appName = profile.product.name.trim();
    if (steps.includes("outro") && !appName) throw new PipelineError("product has no name for the end card", { step: "outro" });
    const voiceAudioPath = steps.includes("outro") && prefs.voice === "female" ? await femaleOutroSpeech(`Download ${appName}`, path.join(scratch, "outro-voice.mp3"), {
      signal: ctx.signal, recordUsage: usage => ctx.recordUsage({ ...usage, accountId: profile.accountId, productId }),
    }) : undefined;

    let out: Awaited<ReturnType<typeof validateEnrichedMedia>>;
    let outputScreening: Awaited<ReturnType<typeof screenFinalClip>>;
    for (let attempt = 0; ; attempt++) {
      current = beforeTail;
      applied.splice(0, applied.length, ...headApplied);
      if (steps.includes("sfx")) {
        await ctx.progress(70, "sfx", attempt === 0 ? "Mixing sound design" : "Remixing sound design without the flagged effect");
        const planJson = path.join(scratch, `sfx-plan-${attempt}.json`);
        const scenes = applied.includes("broll") ? brollScenePlanPath(clip) : undefined;
        await applyStep("sfx", () => runSfxMix(current, kits, path.join(scratch, `clip_sfx_${attempt}.mp4`), { transcriptJson, scenes, exclude, planJson, signal: ctx.signal, onLog: log("sfx") }));
        placements = await readFile(planJson, "utf8").then((t) => (JSON.parse(t) as { placements?: EffectPlacement[] }).placements ?? [], () => []);
        // If recovery removed every effect, sound design was not applied; say so
        // rather than letting the clip count as having it.
        if (exclude.length && placements.length === 0) {
          applied.splice(applied.indexOf("sfx"), 1);
          skipped.sfx = "every effect was removed after screening heard them as music";
        }
      }
      if (steps.includes("outro")) {
        await ctx.progress(85, "outro", "Rendering end card");
        await applyStep("outro", () => runOutro(current, appName, path.join(scratch, `clip_final_${attempt}.mp4`), {
          logo: logoPath,
          voice: prefs.voice,
          voiceAudioPath,
          signal: ctx.signal,
          onLog: log("outro"),
        }));
      }
      if (!applied.length) throw new PipelineError(`no enrichment step succeeded: ${JSON.stringify(skipped)}`, { step: "enrich" });

      await ctx.progress(95, "store", "storing enriched clip");
      out = await validateEnrichedMedia(current, clip, steps.includes("outro"), ctx.signal);
      await ctx.progress(96, "final_screening", "Checking finished clip and added media");
      try {
        outputScreening = await screenFinalClip(ctx, current);
        break;
      } catch (error) {
        const windows = steps.includes("sfx") && attempt < 2 ? sfxRecoveryWindows(error, placements) : null;
        if (!windows) throw error;
        exclude = [...exclude, ...windows];
        await ctx.event("warn", `A sound effect read as music at ${windows.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}s`).join(", ")}; rebuilding without it`, { windows, attempt }, "sfx");
      }
    }
    if (exclude.length && applied.includes("sfx")) skipped.sfx = `effects under ${exclude.length} window(s) removed after screening heard them as music`;

    // A retry keeps its file identity; a new job must not replace an earlier derivative.
    const key = keys.clip(projectId, candidateId, `enriched-${ctx.jobId}`);
    await storage.putFile(key, current, { contentType: "video/mp4" });
    let id = newId();
    id = await saveGeneratedAsset(db, {
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
      metadata: { ...(parent.metadata as Record<string, unknown>), outputScreening, steps: applied, requestedSteps: steps, skipped, voice: steps.includes("outro") ? prefs.voice : undefined, peoplePolicy: steps.includes("broll") ? effectivePeoplePolicy : undefined, derivedFrom: parent.id },
    });
    return { assetId: id, key, steps: applied, skipped };
  });

  await reconcileShortsProject(db, productId, projectId);
  await ctx.progress(100, "done", "enriched clip in review");
  return result;
}
