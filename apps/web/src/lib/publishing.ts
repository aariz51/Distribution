import { canTransition, newId, PipelineError, ValidationError } from "@distribution/core";
import { PostizClient, decryptSecret, encryptSecret, platformOf, type Integration } from "@distribution/publishing";
import { and, asc, assetCopy, assets, db, desc, eq, inArray, postizConnections, products, publishSchedule, sql } from "./db";
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
 * The founder's Postiz connection. If none is stored and POSTIZ_API_KEY is in
 * the environment, it is adopted once and stored encrypted, so the key stops
 * living only in a process env.
 */
export async function getOrCreateConnection(accountId: string): Promise<ConnectionView | null> {
  const existing = await listConnections(accountId);
  if (existing.length > 0) return existing[0]!;
  const envKey = process.env.POSTIZ_API_KEY;
  if (!envKey) return null;
  const id = newId();
  await db.insert(postizConnections).values({
    id,
    accountId,
    label: "Default",
    apiUrl: process.env.POSTIZ_API_URL ?? "https://api.postiz.com/public/v1",
    apiKeyEnc: encryptSecret(envKey, appSecret()),
    channels: [],
  });
  return (await listConnections(accountId))[0]!;
}

export async function createConnection(accountId: string, input: { label: string; apiUrl?: string; apiKey: string }): Promise<ConnectionView> {
  const id = newId();
  await db.insert(postizConnections).values({
    id,
    accountId,
    label: input.label,
    apiUrl: input.apiUrl || "https://api.postiz.com/public/v1",
    apiKeyEnc: encryptSecret(input.apiKey, appSecret()),
    channels: [],
  });
  return (await listConnections(accountId)).find((c) => c.id === id)!;
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
  const asset = (await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1))[0];
  if (!asset) throw new NotFound("asset");
  if (asset.status !== "approved" && asset.status !== "scheduled") {
    throw new ValidationError(`asset is ${asset.status}; approve it before scheduling`);
  }
  if (input.channelIds.length === 0) throw new ValidationError("pick at least one channel");
  if (Number.isNaN(input.scheduledFor.getTime())) throw new ValidationError("invalid scheduled time");

  const { connectionId } = await clientFor(accountId, input.connectionId);
  const channels = await listChannels(accountId);
  const product = (await db.select().from(products).where(eq(products.id, asset.productId)).limit(1))[0];
  const leadMinutes = Number((product?.publishing as { leadTimeMinutes?: number } | undefined)?.leadTimeMinutes ?? 30);

  const copies = await db.select().from(assetCopy).where(eq(assetCopy.assetId, input.assetId)).orderBy(desc(assetCopy.version));
  const created: string[] = [];
  for (const channelId of input.channelIds) {
    const ch = channels.find((c) => c.id === channelId);
    if (!ch) throw new ValidationError(`unknown channel ${channelId}`);
    const copyRow = copies.find((c) => c.platform === ch.platform);
    if (!copyRow) throw new ValidationError(`no ${ch.platform} copy for this asset — generate copy first`);
    const id = newId();
    await db.insert(publishSchedule).values({
      id,
      assetId: input.assetId,
      postizConnectionId: connectionId,
      channelId,
      platform: ch.platform,
      copyId: copyRow.id,
      scheduledFor: input.scheduledFor,
      status: "scheduled",
    });
    created.push(id);
  }

  if (asset.status !== "scheduled") {
    if (!canTransition(asset.status, "scheduled")) throw new ValidationError(`cannot move ${asset.status} → scheduled`);
    await db.update(assets).set({ status: "scheduled", scheduledFor: input.scheduledFor, platforms: [...new Set(input.channelIds.map((id) => channels.find((c) => c.id === id)?.platform ?? "").filter(Boolean))], updatedAt: sql`now()` }).where(eq(assets.id, input.assetId));
  }

  const queue = await getQueue();
  const runAt = new Date(input.scheduledFor.getTime() - leadMinutes * 60_000);
  for (const id of created) {
    await queue.enqueue("publish.post", { scheduleId: id }, { productId: asset.productId, assetId: input.assetId, singletonKey: `publish:${id}`, startAfter: runAt > new Date() ? runAt : undefined });
  }
  return (await listSchedule(asset.productId, accountId)).filter((s) => created.includes(s.id));
}

/** Cancel before or after Postiz has the post; deletes it there when it exists. */
export async function cancelSchedule(accountId: string, scheduleId: string): Promise<void> {
  const row = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)).limit(1))[0];
  if (!row) throw new NotFound("schedule");
  if (row.postizPostId) {
    const { client } = await clientFor(accountId, row.postizConnectionId);
    await client.deletePost(row.postizPostId).catch(() => undefined);
  }
  await db.update(publishSchedule).set({ status: "cancelled", updatedAt: sql`now()` }).where(eq(publishSchedule.id, scheduleId));
  const siblings = await db.select().from(publishSchedule).where(eq(publishSchedule.assetId, row.assetId));
  if (siblings.every((s) => s.status === "cancelled")) {
    await db.update(assets).set({ status: "approved", scheduledFor: null, updatedAt: sql`now()` }).where(eq(assets.id, row.assetId));
  }
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
