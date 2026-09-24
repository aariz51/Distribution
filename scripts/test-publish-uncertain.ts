/** Fault injection only: real queue/DB/upload code against an isolated local HTTP server. No public post. */
import "dotenv/config";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { assets, assetCopy, closeDb, eq, getDb, jobs, products, postizConnections, publishSchedule } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { publishPost, publishPoll } from "@distribution/pipelines";
import { encryptSecret } from "../packages/publishing/src/crypto";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  let creates = 0;
  let uploads = 0;
  let rejectUpload = false;
  let pollArrived: (() => void) | undefined;
  let releasePoll: (() => void) | undefined;
  let pollResponse: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the actual media/form body */ }
    if (req.url?.startsWith("/posts?")) {
      const gate = new Promise<void>(resolve => { releasePoll = resolve; });
      pollArrived?.(); await gate;
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ posts: [pollResponse] }));
    }
    else if (req.url === "/upload" && rejectUpload) { uploads++; res.writeHead(400); res.end("Invalid media for test"); }
    else if (req.url === "/upload") { uploads++; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id: "local-media", path: "http://localhost/local-media" })); }
    else if (req.url === "/posts") { creates++; res.destroy(); }
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const db = getDb(); const queue = await JobQueue.start(db);
  queue.register("publish.post", publishPost);
  queue.register("publish.poll", publishPoll);
  try {
    const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
    const product = (await db.select().from(products).where(eq(products.id, productId)))[0]!;
    // Exercise transport with an actual rendered promo. Legacy clips correctly
    // stop at content screening and are covered by test-publish-screening.ts.
    const original = (await db.select().from(assets).where(eq(assets.productId, productId))).find(a => a.type === "promo_vertical" && a.status !== "failed");
    if (!original) throw new Error("Generate a real QA SafeChoice promo first");
    const assetId = randomUUID(), connectionId = randomUUID(), scheduleId = randomUUID();
    await db.insert(assets).values({ ...original, id: assetId, status: "approved", approvalState: "approved", projectId: null, jobId: null, thumbnailAssetId: null });
    const copy = (await db.insert(assetCopy).values({ id: randomUUID(), assetId, platform: "instagram", caption: "SafeChoice — scan food labels and understand ingredients.", approved: true }).returning())[0]!;
    const port = (server.address() as { port: number }).port;
    await db.insert(postizConnections).values({ id: connectionId, accountId: product.accountId, label: "Local transport failure test", apiUrl: `http://127.0.0.1:${port}`, apiKeyEnc: encryptSecret("local-test", process.env.APP_SECRET!) });
    await db.insert(publishSchedule).values({ id: scheduleId, assetId, copyId: copy.id, channelId: "local-only", platform: copy.platform, scheduledFor: new Date(Date.now() + 86400000), postizConnectionId: connectionId });
    await queue.work(["publish"]);
    for (const mismatch of ["asset", "platform"]) {
      const wrongCopy = (await db.insert(assetCopy).values({ id: randomUUID(), assetId: mismatch === "asset" ? original.id : assetId, platform: mismatch === "platform" ? "youtube" : copy.platform, caption: "Wrong copy regression" }).returning())[0]!;
      const invalidId = randomUUID();
      await db.insert(publishSchedule).values({ id: invalidId, assetId, copyId: wrongCopy.id, channelId: "local-only", platform: copy.platform, scheduledFor: new Date(), postizConnectionId: connectionId });
      const pending = await queue.enqueue("publish.post", { scheduleId: invalidId }, { maxAttempts: 1 });
      let rejected = false;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, pending.jobId)))[0]!;
        if (job.status === "completed") throw new Error("Mismatched copy accepted");
        if (job.status === "failed") {
          if (job.error?.step !== "publish" || !String(job.error.message).includes("no copy written")) throw new Error(`Wrong rejection: ${JSON.stringify(job.error)}`);
          rejected = true; break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!rejected || uploads || creates) throw new Error("Mismatched copy reached transport or did not fail");
    }
    console.log("PASS: copy from another asset or platform is rejected before media upload");
    for (let attempt = 0; attempt < 2; attempt++) {
      const { jobId } = await queue.enqueue("publish.post", { scheduleId }, { maxAttempts: 2 });
      const deadline = Date.now() + 30_000;
      let failed = false;
      while (Date.now() < deadline) {
        const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
        if (row.status === "completed") throw new Error("Unconfirmed post incorrectly completed");
        if (row.status === "failed") { failed = true; break; }
        await new Promise(r => setTimeout(r, 200));
      }
      if (!failed) throw new Error("Expected terminal failure");
    }
    const schedule = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
    if (creates !== 1 || schedule.attempts !== 1 || schedule.postizPostId || !schedule.lastError) throw new Error("Retry duplicated or lost uncertain submission");
    rejectUpload = true;
    const failedId = randomUUID();
    await db.insert(publishSchedule).values({ id: failedId, assetId, copyId: copy.id, channelId: "local-only", platform: copy.platform, scheduledFor: new Date(), postizConnectionId: connectionId });
    const { jobId: failedJob } = await queue.enqueue("publish.post", { scheduleId: failedId }, { maxAttempts: 1 });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, failedJob)))[0]!;
      if (job.status === "failed") break;
      await new Promise(r => setTimeout(r, 100));
    }
    const failed = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, failedId)))[0]!;
    const failedAsset = (await db.select().from(assets).where(eq(assets.id, assetId)))[0]!;
    if (failed.status !== "failed" || !failed.lastError || failed.attempts !== 0 || failedAsset.status !== "failed" || creates !== 1) throw new Error("Upload failure not reflected in calendar and asset");
    console.log("PASS: upload rejection persists calendar/asset failure without attempting a post");
    rejectUpload = false;
    for (const state of ["PUBLISHED", "ERROR", "QUEUE"]) {
      const pollId = randomUUID();
      await db.insert(publishSchedule).values({ id: pollId, assetId, copyId: copy.id, channelId: "local-only", platform: copy.platform, scheduledFor: new Date(Date.now() - 86400000), updatedAt: new Date(Date.now() - 86400000), postizConnectionId: connectionId, postizPostId: "test-post", status: "publishing" });
      pollResponse = { id: "test-post", state };
      const arrived = new Promise<void>(resolve => { pollArrived = resolve; });
      const { jobId } = await queue.enqueue("publish.poll", { scheduleId: pollId }, { maxAttempts: 1 });
      await Promise.race([arrived, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("poll never arrived")), 10000); timer.unref(); })]);
      await db.transaction(async tx => {
        await tx.update(publishSchedule).set({ status: "cancelled" }).where(eq(publishSchedule.id, pollId));
        await tx.update(assets).set({ status: "approved" }).where(eq(assets.id, assetId));
      });
      releasePoll!();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
        if (job.status === "failed") throw new Error("Cancelled poll failed");
        if (job.status === "completed") break;
        await new Promise(r => setTimeout(r, 100));
      }
      const result = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      const cancelled = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, pollId)))[0]!;
      const media = (await db.select().from(assets).where(eq(assets.id, assetId)))[0]!;
      if (result.status !== "completed" || cancelled.status !== "cancelled" || media.status !== "approved") throw new Error(`Late ${state} result overwrote cancellation`);
    }
    console.log("PASS: late published/error/timeout polls preserve cancellation and asset state");
    console.log("PASS: real SafeChoice media upload reaches local test server; lost create response remains unconfirmed; second queue job cannot resubmit");
  } finally { await queue.stop(); await closeDb(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
