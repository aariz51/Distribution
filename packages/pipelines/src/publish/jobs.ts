import { youtubeCover } from "./cover";
import { requireScreenedSource, requireScreenedOutput, screenFinalClip } from "../shorts/screening";
import { sourceAttribution } from "../shorts/attribution";
import { captionLength, composeCaption } from "../copy/caption";
import { PLATFORM_RULES } from "../copy/platform-copy";
import { ScreeningReport } from "../shorts/screening-report";
import { PipelineError, redact } from "@distribution/core";
import { and, assetCopy, assets, desc, eq, postizConnections, publishSchedule, sourceVideos, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { CREATE_POST_HOURLY_LIMIT, PostizClient, PostizError, decryptSecret, platformOf } from "@distribution/publishing";
import { getStorage } from "@distribution/storage";

/** Poll backoff: 2, 4, 8, 16, 32, 64 minutes, then give up at ~2 hours. */
const POLL_STEPS_MIN = [2, 4, 8, 16, 32, 64];

async function clientFor(db: JobContext<"publish.post">["db"], connectionId: string): Promise<PostizClient> {
  const conn = (await db.select().from(postizConnections).where(eq(postizConnections.id, connectionId)).limit(1))[0];
  if (!conn) throw new PipelineError("Postiz connection not found", { retrySafe: false, step: "publish" });
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) throw new PipelineError("APP_SECRET is not set; cannot decrypt the Postiz key", { retrySafe: false, step: "publish" });
  return new PostizClient({ apiUrl: conn.apiUrl, apiKey: decryptSecret(conn.apiKeyEnc, appSecret) });
}

/**
 * publish.post — upload the asset's media to Postiz and create the post.
 *
 * Idempotent on `postizPostId`: if the row already has one, the upload and the
 * create are skipped and the job goes straight to polling. A durable attempt
 * marker prevents resubmission after an ambiguous create response.
 */
export async function publishPost(ctx: JobContext<"publish.post">) {
  try {
    return await submitPost(ctx);
  } catch (error) {
    // Persist failures from upload/configuration too, so the calendar cannot
    // remain indefinitely "publishing" after the actual job has stopped.
    const message = redact(error instanceof Error ? error.message : String(error));
    await ctx.db.transaction(async tx => {
      const row = (await tx.select().from(publishSchedule).where(eq(publishSchedule.id, ctx.payload.scheduleId)).for("update"))[0];
      if (!row || row.status === "cancelled" || row.status === "published") return;
      if (row.postizPostId) {
        await tx.update(publishSchedule).set({ lastError: `Post created; status check failed: ${message}`, updatedAt: sql`now()` }).where(eq(publishSchedule.id, row.id));
        return;
      }
      if (row.attempts > 0) {
        await tx.update(publishSchedule).set({ lastError: `Submission unconfirmed. Check Postiz before retrying. ${message}`, updatedAt: sql`now()` }).where(eq(publishSchedule.id, row.id));
        return;
      }
      await tx.update(publishSchedule).set({ status: "failed", lastError: message, updatedAt: sql`now()` }).where(eq(publishSchedule.id, row.id));
      await tx.update(assets).set({ status: "failed", failureReason: `${row.platform}: ${message}`, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
    });
    throw error;
  }
}

async function submitPost(ctx: JobContext<"publish.post">) {
  const { scheduleId } = ctx.payload;
  const db = ctx.db;
  const row = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)).limit(1))[0];
  if (!row) throw new PipelineError("schedule row not found", { retrySafe: false, step: "publish" });
  if (row.status === "cancelled") {
    await ctx.event("info", "schedule was cancelled; nothing to publish", undefined, "publish");
    return { skipped: "cancelled" };
  }
  if (row.postizPostId) {
    await ctx.event("info", `already created as Postiz post ${row.postizPostId}; polling instead`, undefined, "publish");
    await ctx.queue.enqueue("publish.poll", { scheduleId }, { singletonKey: `poll:${scheduleId}`, startAfter: new Date(Date.now() + 60_000) });
    return { postId: row.postizPostId, reused: true };
  }

  if (row.attempts > 0) throw new PipelineError("Previous Postiz submission is unconfirmed. Check Postiz before submitting again.", { step: "publish" });

  const asset = (await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1))[0];
  if (!asset) throw new PipelineError("asset not found", { retrySafe: false, step: "publish" });
  if (!["approved", "scheduled", "publishing", "failed"].includes(asset.status)) {
    throw new PipelineError(`asset is ${asset.status}; only an approved asset can be published`, { retrySafe: false, step: "publish" });
  }

  if (asset.approvalState !== "approved") throw new PipelineError("Asset approval is required before publishing", { step: "publish" });
  if (["clip", "clip_enriched"].includes(asset.type) && !asset.sourceId) throw new PipelineError("Original source is missing for this clip; regenerate it before publishing", { step: "screening" });
  if (asset.sourceId) await requireScreenedSource(db, asset.sourceId, asset.productId, ctx.signal);
  if (["clip", "clip_enriched"].includes(asset.type)) await requireScreenedOutput(asset.storageKey, asset.metadata.outputScreening, ctx.signal);

  // Respect the provider's hourly create-post budget rather than discovering it as a 429.
  const recent = await db
    .select({ n: sql<number>`count(*)` })
    .from(publishSchedule)
    .where(sql`${publishSchedule.postizPostId} is not null and ${publishSchedule.updatedAt} > now() - interval '1 hour'`);
  if (Number(recent[0]?.n ?? 0) >= CREATE_POST_HOURLY_LIMIT - 5) {
    throw new PipelineError("Postiz hourly post limit nearly reached; retrying later", { retrySafe: true, step: "publish" });
  }

  const copyRow = row.copyId
    ? (await db.select().from(assetCopy).where(and(eq(assetCopy.id, row.copyId), eq(assetCopy.assetId, row.assetId), eq(assetCopy.platform, row.platform))).limit(1))[0]
    : (await db.select().from(assetCopy).where(and(eq(assetCopy.assetId, row.assetId), eq(assetCopy.platform, row.platform))).orderBy(desc(assetCopy.version)).limit(1))[0];
  if (!copyRow) throw new PipelineError(`no copy written for ${row.platform}; generate copy before scheduling`, { retrySafe: false, step: "publish" });

  const source = asset.sourceId ? (await db.select().from(sourceVideos).where(and(eq(sourceVideos.id, asset.sourceId), eq(sourceVideos.productId, asset.productId))))[0] : undefined;
  const attribution = source ? sourceAttribution(source) : undefined;
  const caption = composeCaption(copyRow, attribution);
  if (captionLength(caption, row.platform) > (PLATFORM_RULES[row.platform]?.captionMax ?? 2200)) throw new PipelineError("Caption including source credits exceeds this platform's limit. Shorten the copy or choose another platform.", { step: "publish" });

  const platformSettings: Record<string, unknown> = {};
  if (["youtube", "tiktok", "pinterest"].includes(row.platform)) {
    const title = copyRow.title?.trim();
    if (!title || (row.platform === "youtube" && title.length < 2)) throw new PipelineError("A platform title is required. Edit or regenerate this platform's copy before publishing.", { step: "publish" });
    platformSettings.title = title;
  }
  let cover: typeof assets.$inferSelect | undefined;
  if (row.platform === "youtube" && asset.mimeType.startsWith("video/")) {
    const candidates = await db.select().from(assets).where(and(eq(assets.productId, asset.productId), eq(assets.type, "thumbnail")));
    cover = youtubeCover(asset, candidates);
  }

  const claimed = await db.transaction(async tx => {
    const changed = await tx.update(publishSchedule).set({ status: "publishing", updatedAt: sql`now()` })
      .where(and(eq(publishSchedule.id, scheduleId), sql`${publishSchedule.status} != 'cancelled'`)).returning({ id: publishSchedule.id });
    if (!changed.length) return false;
    await tx.update(assets).set({ status: "publishing", updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
    return true;
  });
  if (!claimed) return { skipped: "cancelled" };

  const client = await clientFor(db, row.postizConnectionId);
  const storage = getStorage();
  const localPath = await storage.localPathFor(asset.storageKey);

  await ctx.progress(20, "upload", `uploading media to Postiz (${row.platform})`);
  const media = await client.uploadFile(localPath, {
    contentType: asset.mimeType, signal: ctx.signal, onLog: (m) => void ctx.event("debug", m, undefined, "upload"),
    validateMedia: ["clip", "clip_enriched"].includes(asset.type) ? async file => {
      if (file !== localPath) return (await screenFinalClip(ctx, file)).contentSha256;
      await requireScreenedOutput(asset.storageKey, asset.metadata.outputScreening, ctx.signal);
      return ScreeningReport.parse(asset.metadata.outputScreening).contentSha256;
    } : undefined,
  });
  await db.update(publishSchedule).set({ postizMediaId: media.id, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));

  if (cover) {
    await ctx.progress(45, "upload_cover", "Uploading the generated YouTube cover");
    const uploadedCover = await client.uploadFile(await storage.localPathFor(cover.storageKey), { contentType: cover.mimeType, signal: ctx.signal });
    if (!uploadedCover.id || !uploadedCover.path) throw new PipelineError("Postiz did not return a usable cover upload", { step: "publish" });
    platformSettings.thumbnail = uploadedCover;
  }

  const due = row.scheduledFor.getTime() <= Date.now() + 60_000;
  await ctx.progress(60, "create", due ? "publishing now" : `scheduling for ${row.scheduledFor.toISOString()}`);
  const reserved = await db.update(publishSchedule).set({ attempts: 1, lastError: "Submission started; awaiting Postiz confirmation", updatedAt: sql`now()` })
    .where(and(eq(publishSchedule.id, scheduleId), eq(publishSchedule.attempts, 0), eq(publishSchedule.status, "publishing"))).returning({ id: publishSchedule.id });
  if (!reserved.length) throw new PipelineError("Another submission already started or the schedule was cancelled", { step: "publish" });
  let created;
  try {
    created = await client.createPost(
    {
      type: due ? "now" : "schedule",
      date: row.scheduledFor.toISOString(),
      posts: [{ integrationId: row.channelId, provider: row.platform, content: caption, media: [media], settings: platformSettings }],
    },
    ctx.signal,
  );
  } catch (error) {
    if (error instanceof PostizError && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)) {
      await db.update(publishSchedule).set({ attempts: 0, status: "failed", lastError: error.message, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    }
    throw error;
  }

  if (!created.id) throw new PipelineError("Postiz accepted the post but returned no id; check Postiz before resubmitting", { retrySafe: false, step: "publish" });

  await db.update(publishSchedule).set({ postizPostId: created.id, attempts: row.attempts + 1, lastError: null, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
  await ctx.event("info", `created Postiz post ${created.id} on ${row.platform}`, undefined, "create");
  await ctx.queue.enqueue("publish.poll", { scheduleId }, { singletonKey: `poll:${scheduleId}`, startAfter: new Date(Date.now() + POLL_STEPS_MIN[0]! * 60_000) });
  await ctx.progress(100, "done", "waiting for the platform to confirm");
  return { postId: created.id, platform: row.platform, scheduledFor: row.scheduledFor.toISOString() };
}

/**
 * publish.poll — ask Postiz whether the post went out, and mirror that onto the
 * asset. The asset only becomes `published` once every one of its schedules has.
 */
export async function publishPoll(ctx: JobContext<"publish.poll">) {
  const { scheduleId } = ctx.payload;
  const db = ctx.db;
  const row = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)).limit(1))[0];
  if (!row) throw new PipelineError("schedule row not found", { retrySafe: false, step: "poll" });
  if (row.status === "published" || row.status === "cancelled") return { state: row.status, noop: true };
  if (!row.postizPostId) throw new PipelineError("nothing to poll: no Postiz post id", { retrySafe: false, step: "poll" });

  const client = await clientFor(db as unknown as JobContext<"publish.post">["db"], row.postizConnectionId);
  const status = await client.getPost(row.postizPostId, ctx.signal, row.scheduledFor);
  const asset = (await db.select().from(assets).where(eq(assets.id, row.assetId)))[0];
  if (asset && ["clip", "clip_enriched"].includes(asset.type)) {
    try {
      if (!asset.sourceId) throw new PipelineError("Original source is missing", { step: "screening" });
      await requireScreenedSource(db, asset.sourceId, asset.productId, ctx.signal);
      await requireScreenedOutput(asset.storageKey, asset.metadata.outputScreening, ctx.signal);
    } catch (error) {
      let message = `Remote clip does not satisfy current screening: ${redact(error instanceof Error ? error.message : String(error))}. `;
      let cancelled = false;
      if (status.state === "pending") {
        try { await client.deletePost(row.postizPostId, ctx.signal); cancelled = true; message += "Pending Postiz schedule cancelled."; }
        catch { message += "Remote cancellation could not be confirmed. Check Postiz immediately."; }
      } else message += status.state === "published" ? "Postiz reports it already published; review the remote post immediately." : "Remote status is uncertain; check Postiz before taking further action.";
      await db.transaction(async tx => {
        const changed = await tx.update(publishSchedule).set({ status: cancelled ? "cancelled" : "failed", lastError: message, updatedAt: sql`now()` })
          .where(and(eq(publishSchedule.id, scheduleId), sql`${publishSchedule.status} not in ('cancelled','published')`)).returning({ id: publishSchedule.id });
        if (changed.length) await tx.update(assets).set({ status: "failed", failureReason: message, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
      });
      throw new PipelineError(message, { step: "screening", retrySafe: false });
    }
  }
  await ctx.event("info", `Postiz reports ${status.state}`, { publishedUrl: status.publishedUrl }, "poll");

  if (status.state === "published" || status.state === "error") {
    const published = status.state === "published";
    const changed = await db.transaction(async tx => {
      const rows = await tx.update(publishSchedule).set({ status: published ? "published" : "failed", publishedUrl: status.publishedUrl, lastError: published ? null : status.error ?? "provider error", updatedAt: sql`now()` })
        .where(and(eq(publishSchedule.id, scheduleId), sql`${publishSchedule.status} != 'cancelled'`)).returning({ id: publishSchedule.id });
      if (!rows.length) return false;
      const siblings = await tx.select().from(publishSchedule).where(eq(publishSchedule.assetId, row.assetId));
      if (published && siblings.every(s => s.status === "published" || s.status === "cancelled")) {
        await tx.update(assets).set({ status: "published", publishedAt: sql`now()`, failureReason: null, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
      } else if (!published) {
        await tx.update(assets).set({ status: "failed", failureReason: `${row.platform}: ${status.error ?? "provider error"}`, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
      }
      return true;
    });
    if (!changed) return { state: "cancelled", noop: true };
    if (!published) throw new PipelineError(`Postiz reported an error for ${row.platform}: ${status.error ?? "unknown"}`, { retrySafe: false, step: "poll" });
    await ctx.progress(100, "done", "published");
    return { state: "published", url: status.publishedUrl };
  }

  const nextIdx = Math.min(row.attempts, POLL_STEPS_MIN.length - 1);
  const waitMin = POLL_STEPS_MIN[nextIdx]!;
  if (Date.now() > Math.max(row.scheduledFor.getTime(), row.updatedAt.getTime()) + 2 * 60 * 60_000) {
    const timedOut = await db.update(publishSchedule).set({ status: "failed", lastError: "no confirmation from Postiz after 2 hours", updatedAt: sql`now()` })
      .where(and(eq(publishSchedule.id, scheduleId), sql`${publishSchedule.status} != 'cancelled'`)).returning({ id: publishSchedule.id });
    if (!timedOut.length) return { state: "cancelled", noop: true };
    throw new PipelineError("Postiz never confirmed publication within 2 hours", { retrySafe: false, step: "poll" });
  }
  await db.update(publishSchedule).set({ attempts: row.attempts + 1 }).where(eq(publishSchedule.id, scheduleId));
  await ctx.queue.enqueue("publish.poll", { scheduleId }, { singletonKey: `poll:${scheduleId}:${row.attempts + 1}`, startAfter: new Date(Date.now() + waitMin * 60_000) });
  await ctx.progress(50, "poll", `still pending; checking again in ${waitMin} min`);
  return { state: status.state, nextCheckMin: waitMin };
}

export { platformOf };
