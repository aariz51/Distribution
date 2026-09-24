import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, features, getDb, jobs, products, projects, sourceVideos, toProductProfile } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceIngest } from "../packages/pipelines/src/shorts/ingest";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), id = randomUUID();
  try {
    const product = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const original = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, "b9d3f51e-3ccd-4487-b64e-8051ed05db55")))[0];
    if (!original?.storageKey || original.productId !== product.id || original.rights !== "licensed" || !original.licenseText) throw new Error("Real licensed nutrition source required");
    await db.insert(sourceVideos).values({ id, productId: product.id, kind: "upload", title: original.title, creator: original.creator, url: original.url, licenseText: original.licenseText, rights: original.rights, status: "discovered", storageKey: original.storageKey });
    queue.register("source.ingest", sourceIngest); await queue.work(["media"]);
    const projectId = randomUUID();
    const profileSnapshot = toProductProfile(product, await db.select().from(features).where(eq(features.productId, product.id)));
    await db.insert(projects).values({ id: projectId, productId: product.id, sourceId: id, kind: "shorts", profileVersion: product.version, status: "running", params: { profileSnapshot } });
    const pending = await queue.enqueue("source.ingest", { productId: product.id, sourceId: id, projectId }, { productId: product.id, sourceId: id, projectId, maxAttempts: 1 });
    const deadline = Date.now() + 180_000;
    let failed = false;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, pending.jobId)))[0]!;
      if (job.status === "completed") throw new Error("Prohibited source incorrectly accepted");
      if (job.status === "failed") { if (job.error?.step !== "screening") throw new Error(`Wrong failure: ${JSON.stringify(job.error)}`); failed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!failed) throw new Error("Screening did not terminate");
    const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, id)))[0]!;
    const screening = source.probe?.screening as { status?: string; contentSha256?: string; audio?: { coverage?: string; rejectedWindows?: number } };
    if (source.status !== "failed" || screening?.status !== "rejected" || screening.contentSha256?.length !== 64 || screening.audio?.coverage !== "all-audio-streams-and-channels" || !screening.audio.rejectedWindows) throw new Error("Missing real rejection evidence");
    const descendants = await db.select().from(jobs).where(eq(jobs.sourceId, id));
    if (descendants.some(job => job.type !== "source.ingest")) throw new Error("Rejected source spawned processing descendants");
    console.log(`PASS: actual original nutrition video rejected for music; ${screening.audio.rejectedWindows} positive windows; persisted hash/coverage; no downstream work`);
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
