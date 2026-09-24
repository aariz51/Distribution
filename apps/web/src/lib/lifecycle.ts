import { assets, db, eq, projects, sql } from "./db";
import { getStorage } from "@distribution/storage";
import { logger } from "@distribution/core";

/**
 * Deleting a run has to remove its files as well as its rows. When the two
 * drift apart the library fills with cards that cannot play, which is a worse
 * failure than an empty library because it looks like the product works.
 *
 * Storage is cleared first: an orphaned file costs disk, an orphaned row costs
 * the user's trust. If storage deletion fails the rows are kept so the next
 * attempt can still find them.
 */
export async function deleteProjectWithStorage(projectId: string): Promise<{ deletedAssets: number }> {
  const storage = getStorage();
  const rows = await db.select({ id: assets.id }).from(assets).where(eq(assets.projectId, projectId));

  // Both prefixes a project can write under (see packages/storage/src/keys.ts).
  for (const prefix of [`promo/${projectId}`, `projects/${projectId}`]) {
    try {
      await storage.deletePrefix(prefix);
    } catch (err) {
      logger.warn({ projectId, prefix, err: String(err) }, "could not clear project storage");
      throw new Error("could not remove this run's files; nothing was deleted");
    }
  }

  await db.delete(projects).where(eq(projects.id, projectId));
  return { deletedAssets: rows.length };
}

/**
 * Mark assets whose file has vanished, so the library shows them as failed with
 * a reason instead of offering a dead play button. Cheap enough to call when a
 * library page loads for a product with a small number of assets.
 */
export async function flagMissingAssets(productId: string): Promise<number> {
  const storage = getStorage();
  const rows = await db
    .select({ id: assets.id, key: assets.storageKey })
    .from(assets)
    .where(sql`${assets.productId} = ${productId} and ${assets.status} <> 'failed'`);
  let flagged = 0;
  for (const r of rows) {
    const head = await storage.head(r.key).catch(() => null);
    if (head && head.size > 0) continue;
    await db
      .update(assets)
      .set({ status: "failed", failureReason: "The generated file is no longer in storage. Regenerate this asset.", updatedAt: sql`now()` })
      .where(eq(assets.id, r.id));
    flagged++;
  }
  return flagged;
}
