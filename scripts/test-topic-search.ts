import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { closeDb, eq, features, getDb, jobs, products, sourceVideos, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceProbe } from "../packages/pipelines/src/shorts/probe";
import { sourceSearch } from "../packages/pipelines/src/shorts/search";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), id = randomUUID();
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const base = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    await db.insert(products).values({ ...base, id, slug: `topic-search-${id}`, sources: { connected: [] } });
    const featureRows = await db.select().from(features).where(eq(features.productId, base.id));
    await db.insert(features).values(featureRows.map(f => ({ ...f, id: randomUUID(), productId: id, evidenceAssetIds: [] })));
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const endpoint = `${origin}/api/products/${id}/sources/search`;
    if ((await fetch(endpoint, { method: "POST" })).status !== 401) throw new Error("Unauthenticated search accepted");
    queue.register("source.search", sourceSearch); queue.register("source.probe", sourceProbe); await queue.work(["light"]);
    const response = await fetch(endpoint, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ query: "ultra processed food health nutrition podcast interview" }) });
    const body = await response.json() as { jobId?: string };
    if (response.status !== 202 || !body.jobId) throw new Error(`Search admission failed: ${response.status}`);
    const deadline = Date.now() + 150_000;
    let completed = false;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, body.jobId)))[0]!;
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!completed) throw new Error("Search did not finish");
    const qualificationDeadline = Date.now() + 10 * 60000;
    let checked = false;
    while (Date.now() < qualificationDeadline) {
      const checks = (await db.select().from(jobs).where(eq(jobs.productId, id))).filter(j => j.type === "source.probe");
      if (checks.length && checks.every(j => ["completed", "failed"].includes(j.status))) { checked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!checked) throw new Error("Real license qualification did not terminate");
    const sources = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, id));
    if (!sources.length || sources.some(s => s.storageKey || s.status !== "discovered" || !s.durationSec || s.durationSec < 300 || s.durationSec > 10800)) throw new Error("Search incorrectly approved/downloaded content or returned invalid duration");
    if (sources.some(s => (s.probe?.screening as { status?: string } | undefined)?.status !== "pending")) throw new Error("Unscreened search result mislabeled");
    const children = (await db.select().from(jobs).where(eq(jobs.productId, id))).filter(j => j.type === "source.ingest");
    if (children.length > 3 || children.some(j => j.payload.screenOnly !== true || sources.find(s => s.id === j.sourceId)?.rights === "unknown")) throw new Error("Qualification bypassed rights or batch bound");
    await writeFile(fileURLToPath(new URL("../storage/tmp/topic-search-qualification.json", import.meta.url)), JSON.stringify({ sources, admitted: children.map(j => ({ sourceId: j.sourceId, payload: j.payload })) }, null, 2));
    for (const job of children) await queue.cancel(job.id);
    console.log(`PASS: authenticated real search found ${sources.length} candidates; live license probes admitted ${children.length} bounded screenings, cancelled before download by this metadata-only test; no false screened recommendations`);
    console.log(sources.slice(0, 3).map(s => ({ title: s.title, durationSec: s.durationSec, url: s.url })));
  } finally { await queue.stop(); await db.delete(products).where(eq(products.id, id)); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
