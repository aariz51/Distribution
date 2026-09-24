import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, products, sourceVideos, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceProbe } from "../packages/pipelines/src/shorts/probe";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  try {
    const base = (await db.select().from(sourceVideos)).find(s => s.storageKey?.endsWith("mp4") && s.durationSec && s.durationSec > 5);
    if (!base) throw new Error("Real stored SafeChoice source required");
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const product = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    const id = randomUUID();
    await db.insert(sourceVideos).values({ ...base, id, productId: product.id, url: null, durationSec: null, status: "ready", rights: "owned" });
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const url = `${origin}/api/products/${product.id}/sources/${id}/probe`;
    if ((await fetch(url, { method: "POST" })).status !== 401) throw new Error("Unauthenticated probe accepted");
    const attempts = await Promise.all([fetch(url, { method: "POST", headers: { cookie } }), fetch(url, { method: "POST", headers: { cookie } })]);
    if (attempts.filter(r => r.status === 202).length !== 1 || attempts.filter(r => r.status === 400).length !== 1) throw new Error(`Concurrent inspection duplicate: ${attempts.map(r => r.status)}`);
    const { jobId } = await attempts.find(r => r.ok)!.json() as { jobId: string };
    queue.register("source.probe", sourceProbe); await queue.work(["light"]);
    async function wait(id: string) {
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
        if (["failed", "completed"].includes(job.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error("Probe timeout");
    }
    const job = await wait(jobId);
    const result = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, id)))[0]!;
    if (job.status !== "completed" || !result.durationSec || result.status !== "ready" || result.rights !== "owned") throw new Error(`Actual local probe failed: ${JSON.stringify(job.error)}`);
    const foreign = await queue.enqueue("source.probe", { productId: randomUUID(), sourceId: id }, { sourceId: id, maxAttempts: 1 });
    if ((await wait(foreign.jobId)).status !== "failed") throw new Error("Foreign source accepted");
    const missingId = randomUUID();
    await db.insert(sourceVideos).values({ ...base, id: missingId, url: null, storageKey: null, status: "discovered", rights: "unknown" });
    const missing = await queue.enqueue("source.probe", { productId: base.productId, sourceId: missingId }, { productId: base.productId, sourceId: missingId, maxAttempts: 1 });
    if ((await wait(missing.jobId)).status !== "failed") throw new Error("Missing media accepted");
    const failure = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, missingId)))[0]!;
    if (!failure.failureReason || failure.status !== "discovered") throw new Error("Metadata error lost or source state overwritten");
    console.log("PASS: normal-login HTTP concurrent inspection queues once; real queued SafeChoice probe persists actual metadata, preserves source state/rights, rejects foreign ownership and records missing-media failure");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
