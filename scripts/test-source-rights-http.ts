import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, products, sourceVideos, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceIngest } from "../packages/pipelines/src/shorts/ingest";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const product = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    const base = (await db.select().from(sourceVideos)).find(s => s.storageKey && s.durationSec && s.durationSec > 0)!;
    const id = randomUUID();
    await db.insert(sourceVideos).values({ ...base, id, productId: product.id, rights: "unknown", attestation: null, url: null, status: "ready" });
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const endpoint = `${origin}/api/products/${product.id}/sources/${id}`;
    const patch = (body: object, path = endpoint) => fetch(path, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    if ((await fetch(endpoint, { method: "PATCH" })).status !== 401) throw new Error("Unauthenticated update accepted");
    if ((await patch({ rights: "owned", confirmed: true }, `${origin}/api/products/${product.id}/sources/${randomUUID()}`)).status !== 404) throw new Error("Missing source accepted");
    for (const invalid of [{ rights: "owned" }, { rights: "third_party_attested", confirmed: true }, { rights: "licensed", confirmed: true, explanation: "short" }]) if ((await patch(invalid)).status !== 400) throw new Error("Unconfirmed rights accepted");
    const pending = await queue.enqueue("source.ingest", { productId: product.id, sourceId: id }, { productId: product.id, sourceId: id, maxAttempts: 1 });
    if ((await patch({ rights: "owned", confirmed: true })).status !== 400) throw new Error("Rights changed during pending work");
    queue.register("source.ingest", sourceIngest); await queue.work(["media"]);
    const deadline = Date.now() + 15_000;
    let rejected = false;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, pending.jobId)))[0]!;
      if (job.status === "failed") { if (job.error?.step !== "rights") throw new Error(`Wrong failure: ${JSON.stringify(job.error)}`); rejected = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!rejected) throw new Error("Stored unknown-rights media was processed");
    const explanation = "QA permission record for this disposable source fixture";
    if ((await patch({ rights: "third_party_attested", confirmed: true, explanation })).status !== 200) throw new Error("Attestation not saved");
    const saved = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, id)))[0]!;
    if (saved.attestation?.text !== explanation || saved.attestation.userId !== user.id || !saved.attestation.at || saved.rights !== "third_party_attested") throw new Error("Attestation audit fields lost");
    if ((await patch({ rights: "unknown" })).status !== 200) throw new Error("Cannot clear declaration");
    console.log("PASS: real HTTP requires confirmation/evidence, persists actor/time/text, rejects pending-work changes, and actual ingest rejects stored media with unknown rights before processing");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
