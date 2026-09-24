/** Local HTTP ownership regression; creates unsent test rows, never enqueues publishing. */
import "dotenv/config";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { assets, closeDb, eq, getDb, products, postizConnections, publishSchedule } from "@distribution/db";
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
async function main() {
  const { SignJWT } = await import(requireWeb.resolve("jose"));
  const db = getDb();
  const assetId = randomUUID(), connectionId = randomUUID(), scheduleId = randomUUID();
  try {
    const product = (await db.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
    const original = (await db.select().from(assets).where(eq(assets.productId, product.id)))[0]!;
    await db.insert(assets).values({ ...original, id: assetId, projectId: null, jobId: null, status: "scheduled", thumbnailAssetId: null });
    await db.insert(postizConnections).values({ id: connectionId, accountId: product.accountId, label: "Local ownership regression (no remote calls)", apiUrl: "http://127.0.0.1:1", apiKeyEnc: "unused" });
    await db.insert(publishSchedule).values({ id: scheduleId, assetId, postizConnectionId: connectionId, channelId: "qa-unsent", platform: "youtube", scheduledFor: new Date(Date.now() + 86400000) });
    for (const [accountId, routeAssetId, expected] of [[randomUUID(), assetId, 404], [product.accountId, randomUUID(), 404], [product.accountId, assetId, 200]] as const) {
      const token = await new SignJWT({ accountId, email: "local-qa@example.invalid" }).setProtectedHeader({ alg: "HS256" }).setSubject(randomUUID()).setExpirationTime("2m").sign(new TextEncoder().encode(process.env.APP_SECRET!));
      const res = await fetch(`http://localhost:3000/api/assets/${routeAssetId}/schedule/${scheduleId}`, { method: "DELETE", headers: { cookie: `dist_session=${token}` } });
      if (res.status !== expected) throw new Error(`expected ${expected}, received ${res.status}`);
      const row = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
      if (row.status !== (expected === 200 ? "cancelled" : "scheduled")) throw new Error("unauthorized mutation or missing cancellation");
    }
    await db.update(publishSchedule).set({ status: "publishing", attempts: 1, postizPostId: null }).where(eq(publishSchedule.id, scheduleId));
    const owner = await new SignJWT({ accountId: product.accountId, email: "local-qa@example.invalid" }).setProtectedHeader({ alg: "HS256" }).setSubject(randomUUID()).setExpirationTime("2m").sign(new TextEncoder().encode(process.env.APP_SECRET!));
    const blocked = await fetch(`http://localhost:3000/api/assets/${assetId}/schedule/${scheduleId}`, { method: "DELETE", headers: { cookie: `dist_session=${owner}` } });
    if (blocked.status !== 400) throw new Error("Unconfirmed submission incorrectly reported cancelled");
    const state = (await db.select().from(publishSchedule).where(eq(publishSchedule.id, scheduleId)))[0]!;
    if (state.status !== "publishing") throw new Error("Submission state lost");
    console.log("PASS: unrelated account and mismatched asset denied without mutation; owner cancels unsent schedule");
  } finally {
    await db.delete(publishSchedule).where(eq(publishSchedule.id, scheduleId));
    await db.delete(assets).where(eq(assets.id, assetId));
    await db.delete(postizConnections).where(eq(postizConnections.id, connectionId));
    await closeDb();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
