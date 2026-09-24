/** Real local API test with unsent future schedules; no provider request. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { assets, assetCopy, closeDb, eq, getDb, jobs, products, postizConnections, publishSchedule, sql } from "@distribution/db";
import { encryptSecret } from "../packages/publishing/src/crypto";
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
async function main() {
  const { SignJWT } = await import(requireWeb.resolve("jose"));
  const db = getDb(); const assetId = randomUUID(), connectionId = randomUUID(), copyId = randomUUID();
  try {
    const product = (await db.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
    const pair = (await db.select({ asset: assets, copy: assetCopy }).from(assets).innerJoin(assetCopy, eq(assetCopy.assetId, assets.id)).where(eq(assets.productId, product.id)))[0]!;
    if (!pair) throw new Error("Real SafeChoice copy input missing");
    await db.insert(assets).values({ ...pair.asset, id: assetId, projectId: null, jobId: null, thumbnailAssetId: null, status: "approved" });
    await db.insert(assetCopy).values({ ...pair.copy, id: copyId, assetId });
    await db.insert(postizConnections).values({ id: connectionId, accountId: product.accountId, label: "Atomic scheduling regression", apiUrl: "http://127.0.0.1:1", apiKeyEnc: encryptSecret("test-only", process.env.APP_SECRET!), channels: [{ id: "qa-channel", identifier: pair.copy.platform, name: "QA", disabled: false }] });
    const jwt = await new SignJWT({ accountId: product.accountId, email: "qa@example.invalid" }).setProtectedHeader({ alg: "HS256" }).setSubject(randomUUID()).setExpirationTime("2m").sign(new TextEncoder().encode(process.env.APP_SECRET!));
    const scheduledFor = new Date(Date.now() + 86400000).toISOString();
    for (const invalid of [true, false, false]) {
      const send = () => fetch(`http://localhost:3000/api/assets/${assetId}/schedule`, { method: "POST", headers: { cookie: `dist_session=${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ connectionId, channelIds: invalid ? ["qa-channel", "missing-channel"] : ["qa-channel", "qa-channel"], scheduledFor }) });
      const responses = await Promise.all(Array.from({ length: invalid ? 1 : 2 }, () => send()));
      if (responses.some(r => r.status !== (invalid ? 400 : 201))) throw new Error("Concurrent scheduling response failed");
      const response = responses[0]!;
      if (response.status !== (invalid ? 400 : 201)) throw new Error(`unexpected scheduling status ${response.status}`);
      const schedules = await db.select().from(publishSchedule).where(eq(publishSchedule.assetId, assetId));
      const submitted = await db.select().from(jobs).where(eq(jobs.assetId, assetId));
      const asset = (await db.select().from(assets).where(eq(assets.id, assetId)))[0]!;
      if (invalid && (schedules.length || submitted.length || asset.status !== "approved")) throw new Error("invalid later channel left partial mutations");
      if (!invalid) {
        if (schedules.length !== 1 || submitted.length !== 1 || schedules[0]!.jobId !== submitted[0]!.id || asset.status !== "scheduled") throw new Error("schedule/job state not committed together or duplicate channel duplicated work");
        const transport = await db.execute(sql`select id from pgboss.job where id = ${submitted[0]!.id}::uuid`);
        if (transport.rows.length !== 1) throw new Error("missing queue message");
      }
    }
    console.log("PASS: invalid later channel leaves zero schedules/jobs; repeated and concurrent identical requests create one linked schedule/app job/queue message");
  } finally {
    const submitted = await db.select().from(jobs).where(eq(jobs.assetId, assetId));
    for (const job of submitted) await db.execute(sql`delete from pgboss.job where id = ${job.id}::uuid`);
    await db.delete(jobs).where(eq(jobs.assetId, assetId));
    await db.delete(publishSchedule).where(eq(publishSchedule.assetId, assetId));
    await db.delete(assets).where(eq(assets.id, assetId));
    await db.delete(postizConnections).where(eq(postizConnections.id, connectionId));
    await closeDb();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
