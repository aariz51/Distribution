import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { assets, assetCopy, closeDb, eq, getDb, jobs, postizConnections, products, publishSchedule, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { encryptSecret } from "../packages/publishing/src/crypto";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  let providerPost: Record<string, unknown> = {}, writes = 0;
  const server = createServer((req, res) => {
    if (req.method !== "GET") writes++;
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ posts: [providerPost] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const product = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    const baseCopy = (await db.select().from(assetCopy).limit(1))[0]!;
    const baseAsset = (await db.select().from(assets).where(eq(assets.id, baseCopy.assetId)))[0]!;
    const assetId = randomUUID(), copyId = randomUUID(), connectionId = randomUUID(), scheduleId = randomUUID();
    await db.insert(assets).values({ ...baseAsset, id: assetId, productId: product.id, projectId: null, jobId: null, status: "publishing", thumbnailAssetId: null });
    await db.insert(assetCopy).values({ ...baseCopy, id: copyId, assetId });
    await db.insert(postizConnections).values({ id: connectionId, accountId: user.accountId, label: "Local reconciliation QA", apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, apiKeyEnc: encryptSecret("local-test", process.env.APP_SECRET!) });
    await db.insert(publishSchedule).values({ id: scheduleId, assetId, copyId, postizConnectionId: connectionId, channelId: "expected-channel", platform: baseCopy.platform, scheduledFor: new Date(), attempts: 1, status: "publishing", lastError: "Unconfirmed local test" });
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const call = (asset = assetId) => fetch(`${origin}/api/assets/${asset}/schedule/${scheduleId}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ postId: "matching-post" }) });
    const expected = [baseCopy.caption, baseCopy.cta, baseCopy.hashtags.map(h => `#${h}`).join(" ")].map(v => (v ?? "").trim()).filter(Boolean).join("\n\n");
    if ((await call(randomUUID())).status !== 404) throw new Error("Wrong asset accepted");
    for (const invalid of [{}, { id: "matching-post", integration: { id: "wrong" }, content: expected }, { id: "matching-post", integration: { id: "expected-channel" }, content: "wrong" }]) {
      providerPost = invalid;
      if ((await call()).status !== 400) throw new Error("Unmatched provider post accepted");
    }
    providerPost = { id: "matching-post", integration: { id: "expected-channel" }, content: expected, state: "QUEUE" };
    const results = await Promise.all([call(), call()]);
    if (results.filter(r => r.status === 200).length !== 1 || results.filter(r => r.status === 400).length !== 1) throw new Error(`Concurrent recovery unexpected: ${results.map(r => r.status)}`);
    const success = results.find(r => r.ok)!; const body = await success.json() as { jobId: string };
    const job = (await db.select().from(jobs).where(eq(jobs.id, body.jobId)))[0]!;
    const recovered = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
    if (job.type !== "publish.poll" || recovered.postizPostId !== "matching-post" || recovered.lastError !== null || writes !== 0) throw new Error("Recovery created a post or lost confirmation");
    await queue.cancel(job.id);
    console.log("PASS: normal-login HTTP rejects mismatched channel/content/asset, concurrent recovery queues exactly one status check, and provider receives GET only");
  } finally { await queue.stop(); await closeDb(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
