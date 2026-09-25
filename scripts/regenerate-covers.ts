import "./_env.js";
import { and, assets, closeDb, eq, getDb } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";

/**
 * Re-queues cover generation for a shorts project's clips, e.g. after a change
 * to how covers are composed. Existing covers are kept; new ones are added.
 *
 *   pnpm exec tsx scripts/regenerate-covers.ts <projectId>
 */
async function main() {
  const projectId = process.argv[2];
  if (!projectId) throw new Error("usage: regenerate-covers.ts <projectId>");
  const db = getDb();
  const clips = await db.select().from(assets).where(and(eq(assets.projectId, projectId), eq(assets.type, "clip")));
  if (clips.length === 0) throw new Error(`no clips in project ${projectId}`);
  const queue = await JobQueue.start(db);
  for (const clip of clips) {
    const r = await queue.enqueue("shorts.thumbnail", { productId: clip.productId, projectId, assetId: clip.id }, { productId: clip.productId, singletonKey: `covers:${clip.id}:${Date.now()}` });
    console.log(JSON.stringify({ clip: clip.id, ...r }));
  }
  await queue.stop();
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
