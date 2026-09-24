/** Real DB replay/preflight regression; no provider call or generated-media claim. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assetCopy, assets, closeDb, eq, getDb } from "@distribution/db";
import { logger } from "@distribution/core";
import { JobQueue } from "@distribution/jobs";
import { copyGenerate } from "@distribution/pipelines";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), assetId = randomUUID(), jobId = randomUUID();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  try {
    const original = (await db.select().from(assets).where(eq(assets.productId, productId))).find(a => a.type === "promo_vertical" && a.status !== "failed");
    if (!original) throw new Error("Real QA promo required");
    await db.insert(assets).values({ ...original, id: assetId, sourceId: null, projectId: null, jobId: null, thumbnailAssetId: null, metadata: { ...original.metadata, attribution: "Required attribution ".repeat(40) } });
    const savedId = randomUUID();
    await db.insert(assetCopy).values({ id: savedId, assetId, platform: "instagram", caption: "Previously saved compatible output", generatedBy: { jobId } });
    for (let attempt = 1; attempt <= 2; attempt++) {
      let blocked = false;
      try {
        await copyGenerate({ jobId, type: "copy.generate", payload: { productId, assetId, platforms: ["instagram", "x"] }, db, queue, log: logger, signal: new AbortController().signal, attempt, maxAttempts: 2, abandoned: false, progress: async () => {}, event: async () => {}, recordUsage: async () => { throw new Error("Unexpected provider spending"); } });
      } catch (error) {
        blocked = error instanceof Error && error.message.includes("caption limit for x");
        if (!blocked) throw error;
      }
      const rows = await db.select().from(assetCopy).where(eq(assetCopy.assetId, assetId));
      if (!blocked || rows.length !== 1 || rows[0]?.id !== savedId) throw new Error("Incompatible platform lost saved output or falsely completed");
    }
    console.log("PASS: incompatible X credit fails before generation; two replays preserve compatible saved copy without extra versions");
  } finally { await db.delete(assets).where(eq(assets.id, assetId)); await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
