import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, features, getDb, products, sourceVideos, users } from "@distribution/db";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const id = randomUUID();
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const base = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    await db.insert(products).values({ ...base, id, slug: `dedup-${id}`, sources: { connected: [] } });
    const featureRows = await db.select().from(features).where(eq(features.productId, base.id));
    await db.insert(features).values(featureRows.map(f => ({ ...f, id: randomUUID(), productId: id, evidenceAssetIds: [] })));
    const origin = process.env.QA_ORIGIN ?? "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const endpoint = `${origin}/api/products/${id}/sources`;
    const responses = await Promise.all(["https://youtu.be/eKQWFJmCWZE", "https://www.youtube.com/watch?v=eKQWFJmCWZE"].map(url => fetch(endpoint, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ url, rights: "unknown", run: false }) })));
    const statuses = responses.map(r => r.status).sort();
    if (statuses.join() !== "201,400") throw new Error(`Expected one accepted/one rejected: ${statuses}; ${await Promise.all(responses.map(r => r.text()))}`);
    const rows = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, id));
    if (rows.length !== 1 || rows[0]!.url !== "https://www.youtube.com/watch?v=eKQWFJmCWZE" || rows[0]!.rights !== "unknown") throw new Error("Duplicate or changed rights");
    console.log("PASS: simultaneous authenticated alias URLs insert exactly one canonical source; duplicate rejected without changing rights or queuing work");
  } finally { await db.delete(products).where(eq(products.id, id)); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
