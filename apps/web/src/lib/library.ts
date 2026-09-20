import { getStorage } from "@distribution/storage";
import { and, asc, assetCopy, assets, candidates, db, desc, eq, inArray, jobs, projects, sourceVideos, sql } from "./db";

const storage = getStorage();

export interface CopyView {
  id: string;
  platform: string;
  hook: string;
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  cta: string;
  version: number;
  approved: boolean;
  createdAt: string;
}

export interface AssetView {
  id: string;
  type: string;
  status: string;
  approvalState: "pending" | "approved" | "rejected";
  approvalReason: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number | null;
  createdAt: string;
  platforms: string[];
  scheduledFor: string | null;
  publishedAt: string | null;
  failureReason: string | null;
  derivedFromAssetId: string | null;
  projectId: string | null;
  sourceId: string | null;
  metadata: Record<string, unknown>;
  candidate: { hook: string; score: number; startSec: number; endSec: number; rank: number } | null;
  copy: CopyView[];
}

/** Back-compat alias for UI code written against the earlier name. */
export type LibraryAsset = AssetView;

export interface SourceView {
  id: string;
  kind: string;
  url: string | null;
  title: string | null;
  creator: string | null;
  durationSec: number | null;
  rights: string;
  status: string;
  licenseText: string | null;
  failureReason: string | null;
  createdAt: string;
  latestProject: { id: string; status: string; createdAt: string } | null;
  clipCount: number;
}

export interface LibraryCounts {
  total: number;
  byStatus: Record<string, number>;
  review: number;
  approved: number;
  published: number;
  failed: number;
}

export interface JobView {
  id: string;
  type: string;
  status: string;
  progressPct: number;
  currentStep: string | null;
  attempts: number;
  error: { message?: string; step?: string | null } | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  projectId: string | null;
  sourceId: string | null;
  assetId: string | null;
  cost: Record<string, unknown>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const generated = sql`(${assets.type} <> 'creative_image' and ${assets.type} <> 'source_original')`;

/** Every generated asset for a product, newest first (brand images and stored originals excluded). */
export async function listAssets(productId: string, opts: { status?: string; type?: string; limit?: number } = {}): Promise<AssetView[]> {
  const conds = [eq(assets.productId, productId), generated];
  if (opts.status) conds.push(eq(assets.status, opts.status as (typeof assets.status.enumValues)[number]));
  if (opts.type) conds.push(eq(assets.type, opts.type as (typeof assets.type.enumValues)[number]));
  const rows = await db
    .select({ a: assets, c: candidates })
    .from(assets)
    .leftJoin(candidates, eq(candidates.id, assets.candidateId))
    .where(and(...conds))
    .orderBy(desc(assets.createdAt))
    .limit(opts.limit ?? 200);
  const ids = rows.map((r) => r.a.id);
  const thumbIds = rows.map((r) => r.a.thumbnailAssetId).filter((x): x is string => Boolean(x));
  const thumbs = thumbIds.length ? await db.select({ id: assets.id, key: assets.storageKey }).from(assets).where(inArray(assets.id, thumbIds)) : [];
  const copies = ids.length ? await db.select().from(assetCopy).where(inArray(assetCopy.assetId, ids)).orderBy(asc(assetCopy.platform), desc(assetCopy.version)) : [];
  return rows.map(({ a, c }) => {
    const t = thumbs.find((x) => x.id === a.thumbnailAssetId);
    return {
      id: a.id,
      type: a.type,
      status: a.status,
      approvalState: a.approvalState,
      approvalReason: a.approvalReason,
      url: storage.publicUrl(a.storageKey),
      thumbnailUrl: t ? storage.publicUrl(t.key) : null,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      durationSec: a.durationSec,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
      platforms: a.platforms,
      scheduledFor: iso(a.scheduledFor),
      publishedAt: iso(a.publishedAt),
      failureReason: a.failureReason,
      derivedFromAssetId: a.derivedFromAssetId,
      projectId: a.projectId,
      sourceId: a.sourceId,
      metadata: a.metadata,
      candidate: c ? { hook: c.hook, score: c.score, startSec: c.startSec, endSec: c.endSec, rank: c.rank } : null,
      copy: copies
        .filter((x) => x.assetId === a.id)
        .map((x) => ({ id: x.id, platform: x.platform, hook: x.hook, title: x.title, caption: x.caption, description: x.description, hashtags: x.hashtags, cta: x.cta, version: x.version, approved: x.approved, createdAt: x.createdAt.toISOString() })),
    };
  });
}

/** Alias kept for the UI. */
export const listLibrary = listAssets;

export async function getAsset(id: string): Promise<AssetView | null> {
  const row = (await db.select({ productId: assets.productId }).from(assets).where(eq(assets.id, id)).limit(1))[0];
  if (!row) return null;
  const list = await listAssets(row.productId, { limit: 500 });
  return list.find((a) => a.id === id) ?? null;
}

export async function libraryCounts(productId: string): Promise<LibraryCounts> {
  const rows = await db.select({ status: assets.status, n: sql<number>`count(*)` }).from(assets).where(and(eq(assets.productId, productId), generated)).groupBy(assets.status);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.n);
    total += Number(r.n);
  }
  return { total, byStatus, review: byStatus.review ?? 0, approved: byStatus.approved ?? 0, published: byStatus.published ?? 0, failed: byStatus.failed ?? 0 };
}

export async function listSources(productId: string): Promise<SourceView[]> {
  const rows = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId)).orderBy(desc(sourceVideos.createdAt));
  const ids = rows.map((r) => r.id);
  const projs = ids.length ? await db.select().from(projects).where(and(eq(projects.productId, productId), inArray(projects.sourceId, ids))).orderBy(desc(projects.createdAt)) : [];
  const clipCounts = ids.length ? await db.select({ sourceId: assets.sourceId, n: sql<number>`count(*)` }).from(assets).where(and(inArray(assets.sourceId, ids), eq(assets.type, "clip"))).groupBy(assets.sourceId) : [];
  return rows.map((r) => {
    const p = projs.find((x) => x.sourceId === r.id);
    return {
      id: r.id,
      kind: r.kind,
      url: r.url,
      title: r.title,
      creator: r.creator,
      durationSec: r.durationSec,
      rights: r.rights,
      status: r.status,
      licenseText: r.licenseText,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      latestProject: p ? { id: p.id, status: p.status, createdAt: p.createdAt.toISOString() } : null,
      clipCount: Number(clipCounts.find((c) => c.sourceId === r.id)?.n ?? 0),
    };
  });
}

export async function listJobs(productId: string, limit = 40): Promise<JobView[]> {
  const rows = await db.select().from(jobs).where(eq(jobs.productId, productId)).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    progressPct: j.progressPct,
    currentStep: j.currentStep,
    attempts: j.attempts,
    error: (j.error as JobView["error"]) ?? null,
    result: j.result,
    createdAt: j.createdAt.toISOString(),
    projectId: j.projectId,
    sourceId: j.sourceId,
    assetId: j.assetId,
    cost: j.cost,
  }));
}
