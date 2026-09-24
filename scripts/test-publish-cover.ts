/** Actual queue/upload payload test against a local Postiz server; no public post. */
import "dotenv/config";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { assetCopy, assets, closeDb, eq, getDb, jobs, postizConnections, products, publishSchedule } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { publishPost } from "@distribution/pipelines";
import { encryptSecret } from "../packages/publishing/src/crypto";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  let uploads = 0, body: Record<string, unknown> | undefined;
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
    const bytes = Buffer.concat(parts);
    res.setHeader("content-type", "application/json");
    if (req.url === "/upload") {
      uploads++;
      const id = uploads === 1 ? "actual-video" : "actual-cover";
      if (uploads === 2 && !bytes.includes(Buffer.from([137,80,78,71,13,10,26,10]))) { res.statusCode = 400; res.end("{}"); return; }
      res.end(JSON.stringify({ id, path: `http://127.0.0.1/media/${id}` }));
    } else if (req.url === "/posts") { body = JSON.parse(bytes.toString()); res.end(JSON.stringify([{ postId: "local-cover-post" }])); }
    else { res.statusCode = 404; res.end("{}"); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const db = getDb(), queue = await JobQueue.start(db), assetId = randomUUID(), connectionId = randomUUID(), scheduleId = randomUUID(), coverId = randomUUID();
  try {
    const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
    const product = (await db.select().from(products).where(eq(products.id, productId)))[0]!;
    const original = (await db.select().from(assets).where(eq(assets.productId, productId))).find(a => a.type === "promo_landscape" && a.thumbnailAssetId && a.status !== "failed");
    if (!original) throw new Error("Real QA SafeChoice landscape promo and cover required");
    const originalCover = (await db.select().from(assets).where(eq(assets.id, original.thumbnailAssetId!)))[0]!;
    await db.insert(assets).values({ ...originalCover, id: coverId, projectId: null, jobId: null, status: "approved", approvalState: "approved" });
    await db.insert(assets).values({ ...original, thumbnailAssetId: coverId, id: assetId, projectId: null, jobId: null, status: "approved", approvalState: "approved" });
    const copyId = randomUUID(), title = "SafeChoice: Understand food labels";
    await db.insert(assetCopy).values({ id: copyId, assetId, platform: "youtube", title, caption: "Read food labels with SafeChoice.", approved: true });
    const port = (server.address() as { port: number }).port;
    await db.insert(postizConnections).values({ id: connectionId, accountId: product.accountId, label: "Local cover transport test", apiUrl: `http://127.0.0.1:${port}`, apiKeyEnc: encryptSecret("local-test", process.env.APP_SECRET!) });
    await db.insert(publishSchedule).values({ id: scheduleId, assetId, copyId, platform: "youtube", channelId: "local-only", scheduledFor: new Date(Date.now() + 86400000), postizConnectionId: connectionId });
    queue.register("publish.post", publishPost); await queue.work(["publish"]);
    const pending = await queue.enqueue("publish.post", { scheduleId }, { maxAttempts: 1 });
    const deadline = Date.now() + 30000;
    let completed = false;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, pending.jobId)))[0]!;
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") { completed = true; break; }
      await new Promise(r => setTimeout(r, 100));
    }
    const posts = body?.posts as { settings: { title: string; thumbnail: { id: string; path: string } }; value: { image: { id: string }[] }[] }[] | undefined;
    if (!completed || uploads !== 2 || posts?.[0]?.settings.title !== title || posts[0].settings.thumbnail.id !== "actual-cover" || posts[0].value[0]?.image[0]?.id !== "actual-video") throw new Error("Actual cover/title were not transmitted correctly");
    console.log("PASS: real SafeChoice video and PNG upload separately; YouTube payload carries exact title and cover id/path");
    for (const job of await db.select().from(jobs)) if (job.type === "publish.poll" && job.payload.scheduleId === scheduleId) await queue.cancel(job.id);
  } finally {
    await queue.stop();
    await db.delete(publishSchedule).where(eq(publishSchedule.id, scheduleId));
    await db.delete(assets).where(eq(assets.id, assetId));
    await db.delete(assets).where(eq(assets.id, coverId));
    await db.delete(postizConnections).where(eq(postizConnections.id, connectionId));
    await closeDb(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
