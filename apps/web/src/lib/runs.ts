import { newId } from "@distribution/core";
import { db, eq, products, projects } from "./db";
import { getQueue } from "./queue";

/** Create a shorts generation run for a source and enqueue the ingest job that chains the rest. */
export async function startRun(productId: string, sourceId: string) {
  const product = (await db.select({ version: products.version }).from(products).where(eq(products.id, productId)).limit(1))[0];
  const projectId = newId();
  await db.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: product?.version ?? 1, sourceId, status: "running" });
  const queue = await getQueue();
  const job = await queue.enqueue("source.ingest", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `ingest:${sourceId}:${projectId}` });
  return { projectId, jobId: job.jobId };
}
