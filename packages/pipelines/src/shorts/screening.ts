import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { ScreeningReport as Report, hasCompleteScreeningPass } from "./screening-report";
import { PipelineError } from "@distribution/core";
import { and, eq, sourceVideos, sql, type Db } from "@distribution/db";
import { bin, run } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { SOURCE_SCREENING_TIMEOUT_SECONDS, type JobContext, type JobTypeName } from "@distribution/jobs";
import { assetsDir } from "./sidecars";

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
async function hashFile(file: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}
/** Mandatory original-media policy, independent of optional cleaning/B-roll preferences. */
export async function screenOriginal<T extends JobTypeName>(ctx: JobContext<T>, sourceId: string, originalKey: string) {
  const storage = getStorage();
  const file = await storage.localPathFor(originalKey);
  const hash = await hashFile(file, ctx.signal);
  const source = (await ctx.db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0];
  if (!source) throw new PipelineError("Source missing", { step: "screening" });
  if (source.rights === "unknown") throw new PipelineError("Confirm source rights before processing", { step: "rights" });
  const cached = Report.safeParse(source.probe?.screening);
  let report = cached.success && cached.data.contentSha256 === hash && (cached.data.status === "rejected" || hasCompleteScreeningPass(cached.data, hash)) ? cached.data : null;
  if (!report) {
    await ctx.event("info", "Screening original audio and video before processing", undefined, "screening");
    report = await inspectMedia(ctx, file);
    await ctx.db.update(sourceVideos).set({ probe: sql`coalesce(${sourceVideos.probe}, '{}'::jsonb) || ${JSON.stringify({ originalStorageKey: originalKey, screening: { ...report, screenedAt: new Date().toISOString() } })}::jsonb`, storageKey: source.storageKey ?? originalKey, updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));
  }
  if (report.status === "allowed" && !hasCompleteScreeningPass(report, hash)) throw new PipelineError("Screening evidence is incomplete or invalid", { step: "screening" });
  if (report.status !== "allowed") throw new PipelineError(`${report.reason}. This source cannot be clipped. Find another video about this product's topic.`, { step: "screening", retrySafe: false, details: { screening: report } });
  return report;
}

/** Publishing must not start a hours-long inference run or accept legacy unscreened clips. */
export async function requireScreenedSource(db: Db, sourceId: string, productId: string, signal: AbortSignal) {
  const source = (await db.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))))[0];
  if (!source || source.rights === "unknown") throw new PipelineError("Source rights or ownership must be confirmed before publishing", { step: "screening" });
  const originalKey = typeof source.probe?.originalStorageKey === "string" ? source.probe.originalStorageKey : source.storageKey;
  if (!originalKey) throw new PipelineError("Original source is missing; cannot verify screening", { step: "screening" });
  const hash = await hashFile(await getStorage().localPathFor(originalKey), signal);
  if (!hasCompleteScreeningPass(source.probe?.screening, hash)) throw new PipelineError("This clip's original source has not passed the current content checks. Screen the source before publishing.", { step: "screening", retrySafe: false });
}

async function inspectMedia<T extends JobTypeName>(ctx: JobContext<T>, file: string) {
  const hash = await hashFile(file, ctx.signal);
  const result = await run(process.env.SCREENING_PYTHON_BIN ?? path.join(workspace, ".venv-screen/bin/python"), [path.join(workspace, "vendor/screening/source_screen.py"), "--video", file, "--audio-model", path.join(process.env.SCREENING_MODEL_DIR ?? path.join(os.homedir(), ".cache/distribution-screening"), "yamnet.h5"), "--visual-model-dir", process.env.SCREENING_VISUAL_MODEL_DIR ?? path.join(os.homedir(), ".cache/autoshorts"), "--face-model", path.join(assetsDir(), "face_detection_yunet_2023mar.onnx")], { signal: ctx.signal, timeoutMs: SOURCE_SCREENING_TIMEOUT_SECONDS * 1000, step: "screening", onStderrLine: line => { if (line.startsWith("[screen]")) void ctx.event("info", line.slice(9), undefined, "screening"); } });
  const report = Report.parse(JSON.parse(result.stdout));
  if (report.contentSha256 !== hash || await hashFile(file, ctx.signal) !== hash) throw new PipelineError("Media changed during screening", { step: "screening" });
  return report;
}

/** Inspect finished media before storing/registering it as an output. */
export async function screenFinalClip<T extends JobTypeName>(ctx: JobContext<T>, file: string) {
  await ctx.event("info", "Checking finished clip, including added footage and audio", undefined, "final_screening");
  const report = await inspectMedia(ctx, file);
  if (!hasCompleteScreeningPass(report, report.contentSha256)) {
    let diagnosticFrameKey: string | undefined;
    const atSec = report.visual?.atSec;
    // Keep bounded visual evidence before the render scratch directory is removed.
    // Diagnostic extraction never changes the screening decision or registers a playable output.
    if (typeof atSec === "number" && Number.isFinite(atSec) && atSec >= 0 && !ctx.signal.aborted) {
      const key = `tmp/diagnostics/jobs/${ctx.jobId}/blocked-frame.jpg`;
      try {
        const storage = getStorage();
        await run(bin("ffmpeg"), ["-v", "error", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease", "-y", await storage.localPathFor(key)], { signal: ctx.signal, timeoutMs: 30000, step: "screening_diagnostic" });
        await storage.commit(key, { contentType: "image/jpeg" });
        diagnosticFrameKey = key;
        await ctx.event("info", "Saved the frame that blocked the finished clip", { diagnosticFrameKey, atSec, contentSha256: report.contentSha256 }, "final_screening");
      } catch {
        await ctx.event("warn", "Could not save the diagnostic frame; the finished clip remains blocked", undefined, "final_screening");
      }
    }
    throw new PipelineError(`Finished clip blocked: ${report.reason.replace("original audio", "finished audio")}`, { step: "final_screening", retrySafe: false, details: { screening: report, diagnosticFrameKey } });
  }
  return { ...report, screenedAt: new Date().toISOString() };
}

/** A valid original does not certify the derived output's different bytes. */
export async function requireScreenedOutput(storageKey: string, evidence: unknown, signal: AbortSignal) {
  const hash = await hashFile(await getStorage().localPathFor(storageKey), signal);
  if (!hasCompleteScreeningPass(evidence, hash)) throw new PipelineError("The finished clip has not passed current content checks. Regenerate it before publishing.", { step: "final_screening", retrySafe: false });
}
