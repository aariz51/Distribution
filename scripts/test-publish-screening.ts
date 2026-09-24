import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { assets, closeDb, eq, getDb, jobs, postizConnections, products, publishSchedule, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { encryptSecret } from "../packages/publishing/src/crypto";
import { publishPost, publishPoll } from "../packages/pipelines/src/publish/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  let requests = 0;
  let remoteMode = false, deletions = 0;
  const server = createServer((req, res) => {
    requests++;
    if (remoteMode && req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ posts: [{ id: "legacy-remote", state: "QUEUE" }] })); }
    else if (remoteMode && req.method === "DELETE" && req.url === "/posts/legacy-remote") { deletions++; res.writeHead(204); res.end(); }
    else { res.writeHead(500); res.end("Unexpected provider call"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const product = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const base = (await db.select().from(assets).where(eq(assets.productId, product.id))).find(asset => asset.type === "clip")!;
    if (!base) throw new Error("Real SafeChoice clip fixture missing");
    const sourceId = randomUUID(), assetId = randomUUID(), connectionId = randomUUID(), scheduleId = randomUUID();
    await db.insert(sourceVideos).values({ id: sourceId, productId: product.id, kind: "upload", rights: "owned", status: "ready", storageKey: "products/6cc41ef3-7761-4520-b843-361ce1b8bca7/sources/c806bbdb-fcd5-4fa6-bdf3-0d1a65238c0e/original.mp4" });
    await db.insert(assets).values({ ...base, id: assetId, projectId: null, sourceId, jobId: null, thumbnailAssetId: null, status: "scheduled", approvalState: "approved" });
    await db.insert(postizConnections).values({ id: connectionId, accountId: product.accountId, label: "No-network screening regression", apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, apiKeyEnc: encryptSecret("local-test", process.env.APP_SECRET!) });
    await db.insert(publishSchedule).values({ id: scheduleId, assetId, postizConnectionId: connectionId, channelId: "qa-only", platform: "youtube", scheduledFor: new Date(), status: "scheduled" });
    queue.register("publish.post", publishPost); queue.register("publish.poll", publishPoll); await queue.work(["publish"]);
    const pending = await queue.enqueue("publish.post", { scheduleId }, { productId: product.id, assetId, maxAttempts: 1 });
    let failed = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, pending.jobId)))[0]!;
      if (job.status === "completed") throw new Error("Unscreened clip was published");
      if (job.status === "failed") { if (job.error?.step !== "screening") throw new Error(`Wrong failure: ${JSON.stringify(job.error)}`); failed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const schedule = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
    if (!failed || requests || schedule.status !== "failed" || schedule.attempts !== 0 || schedule.postizMediaId || schedule.postizPostId) throw new Error("Publishing guard failed or contacted provider");
    console.log("PASS: actual publish worker blocks legacy approved clip before any provider request/upload/create; schedule records failure with zero attempts");
    remoteMode = true;
    await db.update(publishSchedule).set({ postizPostId: "legacy-remote", status: "publishing" }).where(eq(publishSchedule.id, scheduleId));
    const poll = await queue.enqueue("publish.poll", { scheduleId }, { maxAttempts: 1 });
    const pollDeadline = Date.now() + 30000;
    let reconciled = false;
    while (Date.now() < pollDeadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, poll.jobId)))[0]!;
      if (job.status === "completed") throw new Error("Remote legacy clip incorrectly completed");
      if (job.status === "failed") { if (job.error?.step !== "screening") throw new Error(JSON.stringify(job.error)); reconciled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const remote = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
    if (!reconciled || requests !== 2 || deletions !== 1 || remote.status !== "cancelled") throw new Error("Legacy pending remote schedule was not safely reconciled");
    console.log("PASS: local remote-schedule fixture receives GET then DELETE; unscreened legacy clip cannot become a completed publication");
  } finally { await queue.stop(); await closeDb(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
