import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, products, productVersions } from "@distribution/db";
import { createProduct, getProduct, updateProduct } from "../apps/web/src/lib/products";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  let createdId: string | undefined;
  try {
    const base = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const profile = await getProduct(base.accountId, base.id);
    const input = { ...profile, product: { ...profile.product, name: `Channel profile QA ${randomUUID()}`, features: profile.product.features.map(f => ({ ...f, id: randomUUID(), evidenceAssetIds: [] })) }, brand: { cta: profile.brand.cta, screenshotAssetIds: [], otherAssetIds: [] }, sources: { longFormSourceIds: [], connected: [{ kind: "youtube_channel" as const, url: "https://youtube.com/@BBC/featured", rights: "owned" as const, autoQueue: false }, { kind: "youtube_channel" as const, url: "https://www.youtube.com/@BBC/videos", rights: "owned" as const, autoQueue: false }] } };
    const created = await createProduct(base.accountId, input); createdId = created.id;
    if (created.sources.connected.length !== 1 || created.sources.connected[0]!.url !== "https://www.youtube.com/@BBC/videos") throw new Error("Channel canonicalization/deduplication failed");
    await Promise.all([updateProduct(base.accountId, created.id, { ...created, product: { ...created.product, tagline: "First concurrent update" } }), updateProduct(base.accountId, created.id, { ...created, product: { ...created.product, tagline: "Second concurrent update" } })]);
    const final = await getProduct(base.accountId, created.id);
    const versions = await db.select().from(productVersions).where(eq(productVersions.productId, created.id));
    if (final.version !== 3 || versions.length !== 3 || new Set(versions.map(v => v.version)).size !== 3) throw new Error("Concurrent versions collided");
    let rejected = false;
    try { await updateProduct(base.accountId, created.id, { ...final, sources: { ...final.sources, connected: [{ kind: "youtube_channel", url: "https://example.com/not-a-channel", rights: "owned", autoQueue: false }] } }); } catch { rejected = true; }
    if (!rejected || (await getProduct(base.accountId, created.id)).version !== 3) throw new Error("Invalid channel changed profile/version");
    console.log("PASS: connected URLs normalized/deduplicated at save; invalid channel leaves profile unchanged; two concurrent updates create distinct version snapshots");
  } finally {
    if (createdId) await db.update(products).set({ sources: { connected: [] } }).where(eq(products.id, createdId));
    await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
