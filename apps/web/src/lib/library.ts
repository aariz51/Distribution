import { getStorage } from "@distribution/storage";
import { and, assetCopy, assets, db, desc, eq, inArray, jobs } from "./db";

export interface LibraryAsset {
  id: string;
  type: string;
  status: string;
  approvalState: string;
  approvalReason: string | null;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number | null;
  createdAt: string;
  metadata: Record<string, unknown>;
  copy: { id: string; platform: string; hook: string; title: string; caption: string; hashtags: string[]; cta: string; version: number; approved: boolean }[];
  job: { id: string; status: string; error: unknown } | null;
  projectId: string | null;
  derivedFromAssetId: string | null;
}

const LIBRARY_TYPES = ["clip", "clip_enriched", "thumbnail", "creative_image", "promo_vertical", "promo_landscape", "promo_store_portrait", "promo_store_landscape", "creative_direction_md"] as const;

export async function listLibrary(productId: string, filter: { status?: string; type?: string } = {}): Promise<LibraryAsset[]> {
  const storage = getStorage();
  const conds = [eq(assets.productId, productId), inArray(assets.type, [...LIBRARY_TYPES])];
  if (filter.status) conds.push(eq(assets.status, filter.status as never));
  if (filter.type) conds.push(eq(assets.type, filter.type as never));
  const rows = await db.select().from(assets).where(and(...conds)).orderBy(desc(assets.createdAt)).limit(200);
  // brand images are stored as creative_image without a project; hide them from the library
  const visible = rows.filter((r) => !(r.type === "creative_image" && !r.projectId));
  const ids = visible.map((r) => r.id);
  const thumbIds = visible.map((r) => r.thumbnailAssetId).filter((x): x is string => Boolean(x));
  const thumbs = thumbIds.length ? await db.select({ id: assets.id, key: assets.storageKey }).from(assets).where(inArray(assets.id, thumbIds)) : [];
  const copies = ids.length ? await db.select().from(assetCopy).where(inArray(assetCopy.assetId, ids)).orderBy(desc(assetCopy.version)) : [];
  const jobIds = visible.map((r) => r.jobId).filter((x): x is string => Boolean(x));
  const jobRows = jobIds.length ? await db.select({ id: jobs.id, status: jobs.status, error: jobs.error }).from(jobs).where(inArray(jobs.id, jobIds)) : [];
  return visible.map((r) => {
    const seen = new Set<string>();
    const latestCopy = copies.filter((c) => c.assetId === r.id && !seen.has(c.platform) && seen.add(c.platform));
    const thumb = thumbs.find((t) => t.id === r.thumbnailAssetId);
    const job = jobRows.find((j) => j.id === r.jobId) ?? null;
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      approvalState: r.approvalState,
      approvalReason: r.approvalReason,
      url: storage.publicUrl(r.storageKey),
      thumbnailUrl: thumb ? storage.publicUrl(thumb.key) : null,
      width: r.width,
      height: r.height,
      durationSec: r.durationSec,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      metadata: r.metadata,
      copy: latestCopy.map((c) => ({ id: c.id, platform: c.platform, hook: c.hook, title: c.title, caption: c.caption, hashtags: c.hashtags, cta: c.cta, version: c.version, approved: c.approved })),
      job,
      projectId: r.projectId,
      derivedFromAssetId: r.derivedFromAssetId,
    };
  });
}
