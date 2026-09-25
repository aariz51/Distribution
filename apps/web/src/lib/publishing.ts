import { youtubeCover } from "@distribution/pipelines/publishing-cover";
import { canTransition, newId, PipelineError, ValidationError } from "@distribution/core";
import { CONNECTABLE_PROVIDERS, DEFAULT_API_URL, PostizClient, decryptSecret, encryptSecret, platformOf, type Integration } from "@distribution/publishing";
import { isOwnerAccount } from "./auth";
import { and, asc, assetCopy, assets, db, desc, eq, inArray, jobs, postizConnections, products, publishSchedule, sql } from "./db";
import { getQueue } from "./queue";
import { NotFound } from "./api";

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s) throw new PipelineError("APP_SECRET is not set", { retrySafe: false });
  return s;
}

export interface ConnectionView {
  id: string;
  label: string;
  apiUrl: string;
  channels: ChannelView[];
  checkedAt: string | null;
}

export interface ChannelView {
  id: string;
  name: string;
  identifier: string;
  platform: string;
  picture: string | null;
  disabled: boolean;
}

function toChannels(raw: unknown[]): ChannelView[] {
  return (raw as Integration[]).map((c) => ({
    id: c.id,
    name: c.name,
    identifier: c.identifier,
    platform: platformOf(c.identifier),
    picture: c.picture ?? null,
    disabled: Boolean(c.disabled),
  }));
}

export async function listConnections(accountId: string): Promise<ConnectionView[]> {
  const rows = await db.select().from(postizConnections).where(eq(postizConnections.accountId, accountId)).orderBy(asc(postizConnections.createdAt));
  return rows.map((r) => ({ id: r.id, label: r.label, apiUrl: r.apiUrl, channels: toChannels(r.channels), checkedAt: r.checkedAt?.toISOString() ?? null }));
}

/**
 * The workspace's Postiz connection. Only the operator's own workspace may
 * adopt POSTIZ_API_KEY from the environment (stored encrypted, once); any other
 * workspace connects its own Postiz organisation, so nobody can publish to the
 * operator's channels.
 */
export async function getOrCreateConnection(accountId: string): Promise<ConnectionView | null> {
  const existing = await listConnections(accountId);
  if (existing.length > 0) return existing[0]!;
  const envKey = process.env.POSTIZ_API_KEY;
  if (!envKey || !(await isOwnerAccount(accountId))) return null;
  const id = newId();
  await db.insert(postizConnections).values({
    id,
    accountId,
    label: "Default",
    apiUrl: process.env.POSTIZ_API_URL ?? DEFAULT_API_URL,
    apiKeyEnc: encryptSecret(envKey, appSecret()),
    channels: [],
  });
  return (await listConnections(accountId))[0]!;
}

/**
 * Hosts a workspace may point its connection at. Postiz cloud by default; a
 * self-hosted Postiz is added through POSTIZ_ALLOWED_HOSTS. Without this the
 * server would make authenticated requests to any address a user typed.
 */
export function assertAllowedPostizUrl(apiUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new ValidationError("That Postiz address is not a valid URL.");
  }
  const allowed = new Set(["api.postiz.com", ...(process.env.POSTIZ_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)]);
  if (!allowed.has(url.hostname.toLowerCase())) throw new ValidationError(`Postiz at ${url.hostname} is not allowed on this installation.`);
  if (url.protocol !== "https:" && url.hostname === "api.postiz.com") throw new ValidationError("Postiz cloud must be reached over https.");
  return url.toString().replace(/\/$/, "");
}

/** Checks the key against Postiz before storing it, and caches its channels. */
export async function createConnection(accountId: string, input: { label: string; apiUrl?: string; apiKey: string }): Promise<ConnectionView> {
  const apiUrl = assertAllowedPostizUrl(input.apiUrl || process.env.POSTIZ_API_URL || DEFAULT_API_URL);
  const apiKey = input.apiKey.trim();
  let integrations: Integration[];
  try {
    integrations = await new PostizClient({ apiUrl, apiKey }).listIntegrations(AbortSignal.timeout(20_000));
  } catch {
    throw new ValidationError("Postiz did not accept that API key. Copy it again from Postiz → Settings → Public API.");
  }
  const id = newId();
  await db.insert(postizConnections).values({
    id,
    accountId,
    label: input.label,
    apiUrl,
    apiKeyEnc: encryptSecret(apiKey, appSecret()),
    channels: integrations,
    checkedAt: sql`now()`,
  });
  return (await listConnections(accountId)).find((c) => c.id === id)!;
}

/** The provider's sign-in page for adding (or reconnecting) a channel. */
export async function channelConnectUrl(accountId: string, provider: string, refresh?: string): Promise<string> {
  if (!CONNECTABLE_PROVIDERS.some((p) => p.id === provider)) throw new ValidationError(`Unsupported channel type: ${provider}`);
  const { client } = await clientFor(accountId);
  return client.connectUrl(provider, { refresh, signal: AbortSignal.timeout(20_000) });
}

/** Removes a channel from the workspace's Postiz organisation and the cache. */
export async function removeChannel(accountId: string, channelId: string): Promise<ChannelView[]> {
  const channels = await listChannels(accountId);
  if (!channels.some((c) => c.id === channelId)) throw new NotFound("channel");
  const { client } = await clientFor(accountId);
  await client.deleteIntegration(channelId, AbortSignal.timeout(20_000));
  return refreshChannels(accountId);
}

export async function clientFor(accountId: string, connectionId?: string): Promise<{ client: PostizClient; connectionId: string }> {
  const rows = await db.select().from(postizConnections).where(eq(postizConnections.accountId, accountId));
  const row = connectionId ? rows.find((r) => r.id === connectionId) : rows[0];
  if (!row) throw new NotFound("Postiz connection");
  return { client: new PostizClient({ apiUrl: row.apiUrl, apiKey: decryptSecret(row.apiKeyEnc, appSecret()) }), connectionId: row.id };
}

/** Calls Postiz. Only runs when the user asks for it from the UI. */
export async function refreshChannels(accountId: string, connectionId?: string): Promise<ChannelView[]> {
  const { client, connectionId: id } = await clientFor(accountId, connectionId);
  const integrations = await client.listIntegrations();
  await db.update(postizConnections).set({ channels: integrations, checkedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(postizConnections.id, id));
  return toChannels(integrations);
}

export async function listChannels(accountId: string): Promise<ChannelView[]> {
  const conns = await listConnections(accountId);
  return conns.flatMap((c) => c.channels);
}

export interface ScheduleView {
  id: string;
  assetId: string;
  assetType: string;
  assetUrl: string | null;
  channelId: string;
  channelName: string;
  platform: string;
  scheduledFor: string;
  status: string;
  publishedUrl: string | null;
  postizPostId: string | null;
  lastError: string | null;
  attempts: number;
  hook: string | null;
}

export async function listSchedule(productId: string, accountId: string): Promise<ScheduleView[]> {
  const channels = await listChannels(accountId);
  const rows = await db
    .select({ s: publishSchedule, a: assets, c: assetCopy })
    .from(publishSchedule)
    .innerJoin(assets, eq(assets.id, publishSchedule.assetId))
    .leftJoin(assetCopy, eq(assetCopy.id, publishSchedule.copyId))
    .where(eq(assets.productId, productId))
    .orderBy(asc(publishSchedule.scheduledFor));
  return rows.map(({ s, a, c }) => ({
    id: s.id,
    assetId: s.assetId,
    assetType: a.type,
    assetUrl: null,
    channelId: s.channelId,
    channelName: channels.find((ch) => ch.id === s.channelId)?.name ?? s.channelId,
    platform: s.platform,
    scheduledFor: s.scheduledFor.toISOString(),
    status: s.status,
    publishedUrl: s.publishedUrl,
    postizPostId: s.postizPostId,
    lastError: s.lastError,
    attempts: s.attempts,
    hook: c?.hook ?? ((a.metadata as { hook?: string }).hook ?? null),
  }));
}

export interface ScheduleInput {
  assetId: string;
  channelIds: string[];
  scheduledFor: Date;
  connectionId?: string;
}

/**
 * Create one schedule row per channel and queue the publisher to run
 * `leadTimeMinutes` before the slot. The asset moves approved → scheduled
 * through the shared state machine, so an un-approved asset is refused here
 * rather than at the provider.
 */
export async function scheduleAsset(accountId: string, input: ScheduleInput): Promise<ScheduleView[]> {
  if (input.channelIds.length === 0) throw new ValidationError("pick at least one channel");
  if (Number.isNaN(input.scheduledFor.getTime())) throw new ValidationError("invalid scheduled time");
  const { connectionId } = await clientFor(accountId, input.connectionId);
  const queue = await getQueue();
  const result = await db.transaction(async tx => {
    const owned = (await tx.select({ asset: assets, product: products }).from(assets)
      .innerJoin(products, eq(products.id, assets.productId))
      .where(and(eq(assets.id, input.assetId), eq(products.accountId, accountId))).for("update"))[0];
    if (!owned) throw new NotFound("asset");
    const { asset, product } = owned;
    if (asset.status !== "approved" && asset.status !== "scheduled") throw new ValidationError(`asset is ${asset.status}; approve it before scheduling`);
    const connection = (await tx.select().from(postizConnections).where(and(eq(postizConnections.id, connectionId), eq(postizConnections.accountId, accountId))))[0];
    if (!connection) throw new NotFound("Postiz connection");
    const channels = toChannels(connection.channels as Integration[]);
    const copies = await tx.select().from(assetCopy).where(eq(assetCopy.assetId, input.assetId)).orderBy(desc(assetCopy.version));
    const existing = await tx.select().from(publishSchedule).where(and(
      eq(publishSchedule.assetId, asset.id), eq(publishSchedule.postizConnectionId, connectionId),
      eq(publishSchedule.scheduledFor, input.scheduledFor), sql`${publishSchedule.status} != 'cancelled'`,
    ));
    const planned = [...new Set(input.channelIds)].map(channelId => {
      const channel = channels.find(c => c.id === channelId && !c.disabled);
      if (!channel) throw new ValidationError(`unknown or disabled channel ${channelId}`);
      const copy = copies.find(c => c.platform === channel.platform);
      if (!copy) throw new ValidationError(`no ${channel.platform} copy for this asset — generate copy first`);
      const previous = existing.find(s => s.channelId === channelId);
      return { channel, copy, id: previous?.id ?? newId(), reused: Boolean(previous) };
    });
    if (asset.mimeType.startsWith("video/") && planned.some(p => p.channel.platform === "youtube")) {
      const covers = await tx.select().from(assets).where(and(eq(assets.productId, asset.productId), eq(assets.type, "thumbnail")));
      youtubeCover(asset, covers);
    }
    const leadMinutes = Number(product.publishing.leadTimeMinutes ?? 30);
    const runAt = new Date(input.scheduledFor.getTime() - leadMinutes * 60_000);
    for (const { id, channel, copy, reused } of planned) {
      if (reused) continue;
      await tx.insert(publishSchedule).values({ id, assetId: asset.id, postizConnectionId: connectionId, channelId: channel.id, platform: channel.platform, copyId: copy.id, scheduledFor: input.scheduledFor, status: "scheduled" });
      const job = await queue.enqueueInTransaction(tx, "publish.post", { scheduleId: id }, { productId: asset.productId, assetId: asset.id, singletonKey: `publish:${id}`, startAfter: runAt > new Date() ? runAt : undefined });
      await tx.update(publishSchedule).set({ jobId: job.jobId }).where(eq(publishSchedule.id, id));
    }
    if (asset.status !== "scheduled" && !canTransition(asset.status, "scheduled")) throw new ValidationError(`cannot move ${asset.status} → scheduled`);
    await tx.update(assets).set({ status: "scheduled", scheduledFor: input.scheduledFor, platforms: [...new Set([...asset.platforms, ...planned.map(p => p.channel.platform)])], updatedAt: sql`now()` }).where(eq(assets.id, asset.id));
    return { productId: asset.productId, ids: planned.map(p => p.id) };
  });
  return (await listSchedule(result.productId, accountId)).filter(s => result.ids.includes(s.id));

}

/** Cancel before or after Postiz has the post; deletes it there when it exists. */
export async function cancelSchedule(accountId: string, scheduleId: string, assetId: string): Promise<void> {
  await db.transaction(async tx => {
    const owned = (await tx.select({ row: publishSchedule }).from(publishSchedule)
      .innerJoin(assets, eq(assets.id, publishSchedule.assetId))
      .innerJoin(products, eq(products.id, assets.productId))
      .where(and(eq(publishSchedule.id, scheduleId), eq(publishSchedule.assetId, assetId), eq(products.accountId, accountId))).limit(1).for("update"))[0];
    if (!owned) throw new NotFound("schedule");
    const row = owned.row;
    if (row.status === "publishing" && row.attempts > 0 && !row.postizPostId) {
      throw new ValidationError("Postiz submission is in progress or unconfirmed. Check its outcome before cancelling.");
    }
    if (row.postizPostId) {
      const { client } = await clientFor(accountId, row.postizConnectionId);
      await client.deletePost(row.postizPostId);
    }
    await tx.update(publishSchedule).set({ status: "cancelled", updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    const siblings = await tx.select().from(publishSchedule).where(eq(publishSchedule.assetId, row.assetId));
    if (siblings.every((s) => s.status === "cancelled")) {
      await tx.update(assets).set({ status: "approved", scheduledFor: null, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
    }
  });
}

/** Attach only a provider-confirmed matching post; never issue another create. */
export async function reconcileSchedule(accountId: string, scheduleId: string, assetId: string, postId: string) {
  const queue = await getQueue();
  return db.transaction(async tx => {
    const owned = (await tx.select({ row: publishSchedule }).from(publishSchedule)
      .innerJoin(assets, eq(assets.id, publishSchedule.assetId))
      .innerJoin(products, eq(products.id, assets.productId))
      .where(and(eq(publishSchedule.id, scheduleId), eq(publishSchedule.assetId, assetId), eq(products.accountId, accountId))).for("update"))[0];
    if (!owned) throw new NotFound("schedule");
    const row = owned.row;
    if (row.status === "cancelled" || row.status === "published" || row.attempts === 0) throw new ValidationError("This schedule has no unresolved submission");
    if (row.postizPostId && row.postizPostId !== postId) throw new ValidationError("This schedule already belongs to another Postiz post");
    const active = await tx.select().from(jobs).where(sql`${jobs.payload}->>'scheduleId' = ${scheduleId} and ${jobs.status} in ('queued','started','progress','retrying') and ${jobs.type} in ('publish.post','publish.poll')`);
    if (active.length) throw new ValidationError("A submission or status check is still running. Wait for it to finish.");
    const { client } = await clientFor(accountId, row.postizConnectionId);
    const provider = await client.getPost(postId, undefined, row.scheduledFor);
    const raw = provider.raw as { id?: string; integration?: { id?: string }; content?: string };
    if (raw.id !== postId || raw.integration?.id !== row.channelId) throw new ValidationError("Postiz did not return that post for this channel near the scheduled date");
    const copy = row.copyId ? (await tx.select().from(assetCopy).where(eq(assetCopy.id, row.copyId)))[0] : undefined;
    if (!copy) throw new ValidationError("The original post copy is unavailable; reconciliation requires manual investigation");
    const expected = [copy.caption, copy.cta, copy.hashtags.map(h => `#${h}`).join(" ")].map(v => (v ?? "").trim()).filter(Boolean).join("\n\n");
    if (raw.content?.trim() !== expected) throw new ValidationError("Postiz post content does not match this schedule");
    await tx.update(publishSchedule).set({ postizPostId: postId, status: "publishing", lastError: null, updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
    return queue.enqueueInTransaction(tx, "publish.poll", { scheduleId }, { assetId, singletonKey: `reconcile:${scheduleId}:${newId()}` });
  });
}

export interface AutoFillSlot {
  assetId: string;
  hook: string | null;
  channelId: string;
  channelName: string;
  platform: string;
  scheduledFor: string;
}

/**
 * Lay approved assets onto the product's cadence windows: highest-scoring first,
 * never two posts on one channel inside `minGapHours`, and never the same source
 * clip twice on the same channel.
 */
export async function autoFill(productId: string, accountId: string, opts: { dryRun?: boolean; days?: number } = {}): Promise<AutoFillSlot[]> {
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) throw new NotFound("product");
  const pub = product.publishing as { timezone?: string; cadence?: { channelId: string; platform: string; perWeek: number; windows?: { dow: number; start: string; end: string }[] }[]; minGapHours?: number };
  const cadence = pub.cadence ?? [];
  if (cadence.length === 0) throw new ValidationError("no cadence configured for this product");
  const minGapMs = (pub.minGapHours ?? 6) * 3_600_000;

  const approved = await db
    .select()
    .from(assets)
    .where(and(eq(assets.productId, productId), eq(assets.status, "approved")))
    .orderBy(desc(assets.createdAt));
  if (approved.length === 0) return [];

  const existing = await db
    .select({ s: publishSchedule })
    .from(publishSchedule)
    .innerJoin(assets, eq(assets.id, publishSchedule.assetId))
    .where(and(eq(assets.productId, productId), inArray(publishSchedule.status, ["scheduled", "publishing", "published"])));
  const taken = existing.map(({ s }) => ({ channelId: s.channelId, at: s.scheduledFor.getTime(), assetId: s.assetId }));

  const channels = await listChannels(accountId);
  const days = opts.days ?? 14;
  const slots: AutoFillSlot[] = [];
  const pool = [...approved];

  for (let day = 0; day < days && pool.length > 0; day++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + day);
    const dow = date.getDay();
    for (const rule of cadence) {
      if (pool.length === 0) break;
      const windows = (rule.windows ?? []).filter((w) => w.dow === dow);
      for (const w of windows) {
        if (pool.length === 0) break;
        const [h, m] = w.start.split(":").map(Number);
        const at = new Date(date);
        at.setHours(h ?? 9, m ?? 0, 0, 0);
        if (at.getTime() < Date.now()) continue;
        const tooClose = taken.some((t) => t.channelId === rule.channelId && Math.abs(t.at - at.getTime()) < minGapMs);
        if (tooClose) continue;
        const idx = pool.findIndex((a) => !taken.some((t) => t.channelId === rule.channelId && t.assetId === a.id));
        if (idx === -1) continue;
        const asset = pool.splice(idx, 1)[0]!;
        taken.push({ channelId: rule.channelId, at: at.getTime(), assetId: asset.id });
        slots.push({
          assetId: asset.id,
          hook: (asset.metadata as { hook?: string }).hook ?? null,
          channelId: rule.channelId,
          channelName: channels.find((c) => c.id === rule.channelId)?.name ?? rule.channelId,
          platform: rule.platform,
          scheduledFor: at.toISOString(),
        });
      }
    }
  }

  if (!opts.dryRun) {
    for (const s of slots) {
      await scheduleAsset(accountId, { assetId: s.assetId, channelIds: [s.channelId], scheduledFor: new Date(s.scheduledFor) });
    }
  }
  return slots;
}
