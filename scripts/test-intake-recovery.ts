/** Real HTTP/DB intake retries. Requires QA and uses actual SafeChoice logo/screenshots. */
import "./_env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assets, closeDb, eq, getDb, products, users, features } from "@distribution/db";
import { ProductProfileInput, BrandInfo, type ProductProfile } from "@distribution/core";
import { getStorage } from "@distribution/storage";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("QA database required");
  const db = getDb(), origin = "http://127.0.0.1:3002";
  try {
    const original = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const user = (await db.select().from(users).limit(1))[0]!;
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const featureRows = await db.select().from(features).where(eq(features.productId, original.id));
    const baseline = { product: { ...original, brand: BrandInfo.parse(original.brand), product: { ...original.product, features: featureRows.map(f => ({ ...f, detail: f.detail ?? undefined })) } } };
    const input = ProductProfileInput.parse(baseline.product);
    input.product.name = `SafeChoice intake retry ${randomUUID().slice(0, 8)}`;
    input.product.features = input.product.features.map(f => ({ ...f, id: randomUUID(), evidenceAssetIds: [] }));
    input.brand = { ...input.brand, logoAssetId: undefined, screenshotAssetIds: [], otherAssetIds: [] };
    input.sources = { longFormSourceIds: [], connected: [] };
    const requestKey = randomUUID();
    const create = () => fetch(`${origin}/api/products`, { method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": requestKey }, body: JSON.stringify(input) });
    const first = await create(); assert.equal(first.status, 201);
    const product = (await first.json() as { product: ProductProfile }).product;
    const replay = await create(); assert.equal(replay.status, 201);
    assert.equal((await replay.json() as { product: ProductProfile }).product.id, product.id, "retry must resume the same product");
    const concurrent = await Promise.all([create(), create(), create()]);
    for (const response of concurrent) { assert.equal(response.status, 201); assert.equal((await response.json() as { product: ProductProfile }).product.id, product.id); }
    const changed = await fetch(`${origin}/api/products`, { method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": requestKey }, body: JSON.stringify({ ...input, product: { ...input.product, tagline: "different request" } }) });
    assert.equal(changed.status, 400, "same request key cannot create different input");
    const originals = await db.select().from(assets).where(eq(assets.productId, original.id));
    const logo = originals.find(a => a.id === baseline.product.brand.logoAssetId)!;
    const shot = originals.find(a => a.id === baseline.product.brand.screenshotAssetIds[0])!;
    assert(logo && shot, "real SafeChoice assets required");
    const upload = async (source: typeof logo, kind: string, key: string) => {
      const bytes = await readFile(await getStorage().localPathFor(source.storageKey));
      const data = new FormData(); data.set("kind", kind); data.set("file", new Blob([bytes], { type: source.mimeType }), source.storageKey.split("/").at(-1)!);
      return fetch(`${origin}/api/products/${product.id}/assets`, { method: "POST", headers: { cookie, "idempotency-key": key }, body: data });
    };
    const logoKey = randomUUID(), shotKey = randomUUID();
    const uploaded = await upload(logo, "logo", logoKey); assert.equal(uploaded.status, 201);
    const logoId = (await uploaded.json() as { assetId: string }).assetId;
    const repeated = await upload(logo, "logo", logoKey); assert.equal(repeated.status, 201);
    assert.equal((await repeated.json() as { assetId: string }).assetId, logoId);
    const sameShots = await Promise.all([upload(shot, "screenshot", shotKey), upload(shot, "screenshot", shotKey)]);
    const shotIds = [];
    for (const result of sameShots) { assert.equal(result.status, 201); shotIds.push((await result.json() as { assetId: string }).assetId); }
    assert.equal(shotIds[0], shotIds[1]);
    const mismatch = await upload(shot, "screenshot", logoKey); assert.equal(mismatch.status, 400);
    const saved = await fetch(`${origin}/api/products/${product.id}`, { headers: { cookie } }).then(r => r.json()) as { product: ProductProfile; brandAssets: unknown[] };
    assert.equal(saved.product.brand.logoAssetId, logoId);
    assert.deepEqual(saved.product.brand.screenshotAssetIds, [shotIds[0]]);
    assert.equal(saved.brandAssets.length, 2);
    console.log(`PASS: lost-response replay, concurrent creation/upload and mismatched retry protection using real SafeChoice assets (${product.id})`);
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
