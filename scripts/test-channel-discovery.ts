import "dotenv/config";
import { closeDb, connectedSources, eq, getDb, jobs, products, sourceVideos, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceDiscover } from "../packages/pipelines/src/shorts/discover";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  let restore: { id: string; sources: Record<string, unknown> } | undefined;
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const product = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    restore = { id: product.id, sources: product.sources };
    // Disposable configuration fixture only, not a claim that SafeChoice owns BBC.
    // No media queues run: this test reads public metadata only.
    const channelUrl = "https://www.youtube.com/@BBC/videos";
    await db.update(products).set({ sources: { ...product.sources, connected: [{ kind: "youtube_channel", url: channelUrl, rights: "owned", autoQueue: false }] } }).where(eq(products.id, product.id));
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const endpoint = `${origin}/api/products/${product.id}/sources/discover`;
    if ((await fetch(endpoint, { method: "POST" })).status !== 401) throw new Error("Unauthenticated discovery accepted");
    const denied = await fetch(endpoint, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ channelUrl: "https://www.youtube.com/@unconnected" }) });
    if (denied.status !== 400) throw new Error("Unconnected channel accepted by API");
    queue.register("source.discover", sourceDiscover); await queue.work(["light"]);
    async function inspect() {
      const response = await fetch(endpoint, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ channelUrl }) });
      if (response.status !== 202) throw new Error(`Discovery HTTP failed: ${response.status}`);
      const { jobId } = await response.json() as { jobId: string };
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
        if (job.status === "failed") throw new Error(JSON.stringify(job.error));
        if (job.status === "completed") return job.result!;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error("Channel scan timed out");
    }
    const first = await inspect();
    const before = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, product.id));
    if (!(Number(first.found) > 0) || first.queued !== 0) throw new Error("No real channel data or unwanted ingestion");
    const second = await inspect();
    const after = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, product.id));
    const observed = after.filter(source => source.probe?.discoveredFrom === channelUrl);
    if (second.added !== 0 || before.length !== after.length || observed.some(source => source.status !== "discovered" || source.storageKey !== null || !source.title)) throw new Error("Discovery deduplication or metadata-only contract failed");
    const polled = (await db.select().from(connectedSources).where(eq(connectedSources.productId, product.id))).find(c => c.url === channelUrl);
    if (!polled?.lastPolledAt) throw new Error("Poll time missing");
    const invalid = await queue.enqueue("source.discover", { productId: product.id, channelUrl: "https://www.youtube.com/@unconnected" }, { productId: product.id, maxAttempts: 1 });
    const limit = Date.now() + 10_000;
    while (Date.now() < limit) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, invalid.jobId)))[0]!;
      if (job.status === "failed") { console.log(`PASS: real channel returned ${first.found} videos, repeated scan added zero duplicates, stored metadata only, and unconnected channel rejected`); return; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Unconnected channel was not rejected");
  } finally {
    if (restore) {
      await db.update(products).set({ sources: restore.sources }).where(eq(products.id, restore.id));
      // Remove the test's ownership classification from public third-party metadata.
      const discovered = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, restore.id))).filter(source => source.probe?.discoveredFrom === "https://www.youtube.com/@BBC/videos");
      for (const source of discovered) await db.update(sourceVideos).set({ rights: "unknown" }).where(eq(sourceVideos.id, source.id));
    }
    await queue.stop(); await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
