import { loadProfile } from "../packages/pipelines/src/shorts/common";
import "dotenv/config";
import { openAsBlob } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { closeDb, eq, getDb, products, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { getStorage } from "@distribution/storage";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  const origin = "http://127.0.0.1:3002";
  try {
    let product = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "upload-acceptance@local", password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!login.ok || !cookie) throw new Error("Normal login failed");
    const profile = await loadProfile(db, product.id);
    const created = await fetch(`${origin}/api/products`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ ...profile, product: { ...profile.product, name: `Upload QA ${randomUUID().slice(0, 8)}`, features: profile.product.features.map(f => ({ ...f, id: randomUUID() })) }, brand: { cta: profile.brand.cta, screenshotAssetIds: [], otherAssetIds: [] }, sources: { longFormSourceIds: [], connected: [] } }) });
    if (created.status !== 201) throw new Error(`QA intake failed: ${created.status}`);
    product = (await created.json() as { product: typeof product }).product;
    const input = path.resolve("storage/tmp/qa-safechoice-broll/broll-text/restored.mp4");
    const form = new FormData(); form.set("file", await openAsBlob(input, { type: "video/mp4" }), "safechoice.mp4"); form.set("rights", "owned");
    const response = await fetch(`${origin}/api/products/${product.id}/sources`, { method: "POST", headers: { cookie }, body: form });
    const result = await response.json() as { sourceId?: string; jobId?: string };
    if (response.status !== 201 || !result.sourceId || !result.jobId) throw new Error(`Upload failed: ${response.status} ${JSON.stringify(result)}`);
    await queue.cancel(result.jobId);
    const saved = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, result.sourceId)))[0]!;
    const stored = await getStorage().localPathFor(saved.storageKey!);
    const hash = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
    if (await hash(input) !== await hash(stored)) throw new Error("Stored upload differs from source");
    const invalid = new FormData(); invalid.set("file", new Blob(["empty-media"]), "bad.mp4"); invalid.set("rights", "unknown");
    const denied = await fetch(`${origin}/api/products/${product.id}/sources`, { method: "POST", headers: { cookie }, body: invalid });
    if (denied.status !== 400) throw new Error("Undeclared rights not rejected");
    if ((await readdir(path.resolve("storage/tmp/qa-upload-staging"))).length) throw new Error("Staging files leaked");
    console.log("PASS: authenticated production HTTP streams real SafeChoice video, persists identical bytes, queues ingest, rejects missing rights and cleans staging; test ingest cancelled before providers");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
