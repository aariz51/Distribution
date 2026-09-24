import { assetCopy, assets, candidates, eq, projects, sql, type Db } from "@distribution/db";
import { loadProfile } from "./common";
import { enrichStepsFor } from "./enrich/steps";
import { requireScreenedOutput } from "./screening";
import { THUMBNAIL_VARIANTS } from "../thumbnail-render";
import { validateCreative } from "./sidecars";
import { getStorage } from "@distribution/storage";

type Asset = typeof assets.$inferSelect;
export function hasThumbnailVariants(clip: Asset, files: Asset[], readable: Set<string>): boolean {
  return THUMBNAIL_VARIANTS.every(variant => files.some(t =>
    t.productId === clip.productId && t.projectId === clip.projectId && t.type === "thumbnail" &&
    t.derivedFromAssetId === clip.id && t.metadata.variant === variant.name &&
    t.width === variant.size[0] && t.height === variant.size[1] &&
    t.status !== "failed" && t.status !== "archived" && t.approvalState !== "rejected" && readable.has(t.id) &&
    (variant.name !== "portrait" || t.id === clip.thumbnailAssetId)));
}

/** Completion means every selected clip and its requested deliverables exist. */
export async function reconcileShortsProject(db: Db, productId: string, projectId: string): Promise<void> {
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!project || project.kind !== "shorts" || project.productId !== productId) return;
  const profile = await loadProfile(db, productId, projectId);
  const selected = (await db.select().from(candidates).where(eq(candidates.projectId, projectId))).filter(c => c.selected);
  if (!selected.length) return;
  const files = await db.select().from(assets).where(eq(assets.projectId, projectId));
  const copy = await db.select({ assetId: assetCopy.assetId, platform: assetCopy.platform }).from(assetCopy).innerJoin(assets, eq(assets.id, assetCopy.assetId)).where(eq(assets.projectId, projectId));
  const platforms = profile.publishing.cadence.length ? [...new Set(profile.publishing.cadence.map(c => c.platform))] : ["instagram", "x", "youtube", "linkedin", "tiktok"];
  const prefs = profile.contentPreferences;
  const requiredEnrichment = enrichStepsFor(prefs);
  const screened = new Set<string>();
  const readableCovers = new Set<string>();
  for (const cover of files.filter(a => a.type === "thumbnail")) {
    const variant = THUMBNAIL_VARIANTS.find(v => v.name === cover.metadata.variant);
    if (!variant || cover.productId !== productId) continue;
    try {
      await validateCreative(await getStorage().localPathFor(cover.storageKey), variant.size, AbortSignal.timeout(30_000));
      readableCovers.add(cover.id);
    } catch { /* A missing or corrupt cover is an incomplete deliverable. */ }
  }
  for (const asset of files.filter(a => ["clip", "clip_enriched"].includes(a.type) && a.status !== "failed" && a.approvalState !== "rejected")) {
    try {
      await requireScreenedOutput(asset.storageKey, asset.metadata.outputScreening, AbortSignal.timeout(30_000));
      screened.add(asset.id);
    } catch { /* Missing, changed or unscreened output cannot complete a project. */ }
  }
  const ready = selected.every(c => files.some(a =>
    screened.has(a.id) && a.candidateId === c.id && a.type === "clip" &&
    hasThumbnailVariants(a, files, readableCovers) &&
    platforms.every(p => copy.some(v => v.assetId === a.id && v.platform === p)) &&
    (!requiredEnrichment.length || files.some(e => {
      const applied = e.metadata.steps;
      return screened.has(e.id) && e.type === "clip_enriched" &&
        e.derivedFromAssetId === a.id && e.thumbnailAssetId === a.thumbnailAssetId &&
        Array.isArray(applied) && requiredEnrichment.every(step => applied.includes(step));
    }))));
  if (ready) await db.update(projects).set({ status: "completed", updatedAt: sql`now()` }).where(sql`${projects.id} = ${projectId} and ${projects.status} in ('created','running')`);
}
