/**
 * Start a shorts run for a product from a local file (rights: owned) without the web app.
 *   pnpm exec tsx scripts/run-shorts.ts --product <productId> --file /path/to/video.mp4
 * Prints the sourceId, projectId and ingest jobId. The worker must be running.
 */
import "./_env";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { newId } from "@distribution/core";
import { closeDb, eq, getDb, products, projects, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { getStorage, keys } from "@distribution/storage";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  throw new Error(`missing --${name}`);
}

async function main() {
  const db = getDb();
  const storage = getStorage();
  const productId = arg("product");
  const file = path.resolve(arg("file"));
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) throw new Error("product not found");
  const sourceId = newId();
  const ext = path.extname(file).slice(1).toLowerCase() || "mp4";
  const key = keys.sourceOriginal(productId, sourceId, ext);
  await copyFile(file, await storage.localPathFor(key));
  await storage.commit(key);
  await db.insert(sourceVideos).values({ id: sourceId, productId, kind: "upload", title: path.basename(file), rights: "owned", status: "queued", storageKey: key, attestation: { text: "local file supplied by the founder as own content", at: new Date().toISOString() } });
  const projectId = newId();
  await db.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: product.version, sourceId, status: "created" });
  const queue = await JobQueue.start(db);
  const res = await queue.enqueue("source.ingest", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `source.ingest:${sourceId}:${projectId}` });
  await queue.stop();
  console.log(JSON.stringify({ sourceId, projectId, ...res }, null, 2));
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
