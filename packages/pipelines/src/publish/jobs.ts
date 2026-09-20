import { PipelineError } from "@distribution/core";
import { and, assetCopy, assets, desc, eq, postizConnections, publishSchedule, sql } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { CREATE_POST_HOURLY_LIMIT, PostizClient, decryptSecret, platformOf } from "@distribution/publishing";
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
 * create are skipped and the job goes straight to polling, so a retry after a
 * timeout cannot double-post.
 */
export async function publishPost(ctx: JobContext<"publish.post">) {
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

  const asset = (await db.select().from(assets).where(eq(assets.id, row.assetId)).limit(1))[0];
  if (!asset) throw new PipelineError("asset not found", { retrySafe: false, step: "publish" });
  if (!["approved", "scheduled", "publishing", "failed"].includes(asset.status)) {
    throw new PipelineError(`asset is ${asset.status}; only an approved asset can be published`, { retrySafe: false, step: "publish" });
  }

  // Respect the provider's hourly create-post budget rather than discovering it as a 429.
  const recent = await db
    .select({ n: sql<number>`count(*)` })
    .from(publishSchedule)
    .where(sql`${publishSchedule.postizPostId} is not null and ${publishSchedule.updatedAt} > now() - interval '1 hour'`);
  if (Number(recent[0]?.n ?? 0) >= CREATE_POST_HOURLY_LIMIT - 5) {
    throw new PipelineError("Postiz hourly post limit nearly reached; retrying later", { retrySafe: true, step: "publish" });
  }

  const copyRow = row.copyId
    ? (await db.select().from(assetCopy).where(eq(assetCopy.id, row.copyId)).limit(1))[0]
    : (await db.select().from(assetCopy).where(and(eq(assetCopy.assetId, row.assetId), eq(assetCopy.platform, row.platform))).orderBy(desc(assetCopy.version)).limit(1))[0];
  if (!copyRow) throw new PipelineError(`no copy written for ${row.platform}; generate copy before scheduling`, { retrySafe: false, step: "publish" });

  const caption = [copyRow.caption, copyRow.cta, copyRow.hashtags.map((h) => `#${h}`).join(" ")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  await db.update(publishSchedule).set({ status: "publishing", updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
  await db.update(assets).set({ status: "publishing", updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));

  const client = await clientFor(db, row.postizConnectionId);
  const storage = getStorage();
  const localPath = await storage.localPathFor(asset.storageKey);

  await ctx.progress(20, "upload", `uploading media to Postiz (${row.platform})`);
  const media = await client.uploadFile(localPath, { contentType: asset.mimeType, signal: ctx.signal, onLog: (m) => void ctx.event("debug", m, undefined, "upload") });
  await db.update(publishSchedule).set({ postizMediaId: media.id, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));

  const due = row.scheduledFor.getTime() <= Date.now() + 60_000;
  await ctx.progress(60, "create", due ? "publishing now" : `scheduling for ${row.scheduledFor.toISOString()}`);
  const created = await client.createPost(
    {
      type: due ? "now" : "schedule",
      date: row.scheduledFor.toISOString(),
      posts: [{ integrationId: row.channelId, provider: row.platform, content: caption, media: [media] }],
    },
    ctx.signal,
  );
  if (!created.id) throw new PipelineError("Postiz accepted the post but returned no id", { retrySafe: true, step: "publish" });

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
  const status = await client.getPost(row.postizPostId, ctx.signal);
  await ctx.event("info", `Postiz reports ${status.state}`, { publishedUrl: status.publishedUrl }, "poll");

  if (status.state === "published") {
    await db.update(publishSchedule).set({ status: "published", publishedUrl: status.publishedUrl, lastError: null, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    const siblings = await db.select().from(publishSchedule).where(eq(publishSchedule.assetId, row.assetId));
    const outstanding = siblings.filter((s) => s.status !== "published" && s.status !== "cancelled");
    if (outstanding.length === 0) {
      await db.update(assets).set({ status: "published", publishedAt: sql`now()`, failureReason: null, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
      await ctx.event("info", "every channel published; asset marked published", undefined, "poll");
    }
    await ctx.progress(100, "done", "published");
    return { state: "published", url: status.publishedUrl };
  }

  if (status.state === "error") {
    await db.update(publishSchedule).set({ status: "failed", lastError: status.error ?? "provider error", updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    await db.update(assets).set({ status: "failed", failureReason: `${row.platform}: ${status.error ?? "provider error"}`, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
    throw new PipelineError(`Postiz reported an error for ${row.platform}: ${status.error ?? "unknown"}`, { retrySafe: false, step: "poll" });
  }

  const nextIdx = Math.min(row.attempts, POLL_STEPS_MIN.length - 1);
  const waitMin = POLL_STEPS_MIN[nextIdx]!;
  const elapsed = Date.now() - row.updatedAt.getTime();
  if (elapsed > 2 * 60 * 60_000) {
    await db.update(publishSchedule).set({ status: "failed", lastError: "no confirmation from Postiz after 2 hours", updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    throw new PipelineError("Postiz never confirmed publication within 2 hours", { retrySafe: false, step: "poll" });
  }
  await db.update(publishSchedule).set({ attempts: row.attempts + 1 }).where(eq(publishSchedule.id, scheduleId));
  await ctx.queue.enqueue("publish.poll", { scheduleId }, { singletonKey: `poll:${scheduleId}:${row.attempts + 1}`, startAfter: new Date(Date.now() + waitMin * 60_000) });
  await ctx.progress(50, "poll", `still pending; checking again in ${waitMin} min`);
  return { state: status.state, nextCheckMin: waitMin };
}

export { platformOf };
