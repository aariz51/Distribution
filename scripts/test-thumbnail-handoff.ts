/** Database race regression using existing real SafeChoice media; does not claim a new render. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, closeDb, eq, getDb } from "@distribution/db";
import { attachClipThumbnail, saveGeneratedAsset } from "../packages/pipelines/src/generated-assets";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  const ids: string[] = [];
  try {
    const media = await db.select().from(assets).where(eq(assets.productId, productId));
    const original = media.find(a => a.type === "clip");
    const thumb = media.find(a => a.type === "thumbnail");
    if (!original || !thumb) throw new Error("Existing SafeChoice clip and thumbnail required");
    for (const order of ["thumbnail-first", "derivative-first", "concurrent"]) {
      const parentId = randomUUID(), childId = randomUUID(); ids.push(parentId, childId);
      await db.insert(assets).values({ ...original, id: parentId, projectId: null, jobId: null, candidateId: null, thumbnailAssetId: null });
      const save = () => saveGeneratedAsset(db, { ...original, id: childId, projectId: null, jobId: null, candidateId: null, type: "clip_enriched", derivedFromAssetId: parentId, thumbnailAssetId: null, storageKey: `qa-handoff/${childId}.mp4` });
      const attach = () => attachClipThumbnail(db, productId, parentId, thumb.id);
      if (order === "thumbnail-first") { await attach(); await save(); }
      else if (order === "derivative-first") { await save(); await attach(); }
      else await Promise.all([save(), attach()]);
      await save(); // A retry with a stale null snapshot must not remove the thumbnail.
      const result = (await db.select().from(assets).where(eq(assets.id, childId)))[0];
      if (result?.thumbnailAssetId !== thumb.id) throw new Error(`${order} lost thumbnail`);
    }
    console.log("PASS: both completion orders, concurrent handoff and stale-null save replay retain the thumbnail");
  } finally {
    for (const id of ids.reverse()) await db.delete(assets).where(eq(assets.id, id));
    await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
