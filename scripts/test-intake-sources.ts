import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, products, productVersions, sourceVideos } from "@distribution/db";
import { createProduct, getProduct } from "../apps/web/src/lib/products";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  try {
    const original = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const profile = await getProduct(original.accountId, original.id);
    const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, original.id))).find(s => s.url);
    if (!source?.url) throw new Error("Real SafeChoice source URL required");
    const input = { ...profile, product: { ...profile.product, name: `Intake QA ${randomUUID().slice(0, 8)}`, features: profile.product.features.map(f => ({ ...f, id: randomUUID() })) }, sources: { ...profile.sources, longFormSourceIds: [] } };
    const created = await createProduct(profile.accountId, input, [{ url: source.url, rights: "licensed" }, { url: source.url, rights: "licensed" }]);
    const rows = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, created.id));
    const version = (await db.select().from(productVersions).where(eq(productVersions.productId, created.id)))[0]!;
    if (rows.length !== 1 || rows[0]!.rights !== "licensed" || rows[0]!.status !== "discovered" || created.sources.longFormSourceIds[0] !== rows[0]!.id || (version.snapshot.sources as { longFormSourceIds: string[] }).longFormSourceIds[0] !== rows[0]!.id) throw new Error("Intake source/profile/version mismatch");
    let rejected = false;
    const invalid = { ...input, product: { ...input.product, name: `Invalid QA ${randomUUID()}` } };
    try { await createProduct(profile.accountId, invalid, [{ url: "https://example.com/not-youtube", rights: "owned" }]); } catch { rejected = true; }
    const leftovers = (await db.select().from(products)).filter(p => p.product.name === invalid.product.name);
    if (!rejected || leftovers.length) throw new Error("Invalid URL left a partial product");
    console.log("PASS: intake saves deduplicated real source URL and rights with profile/version; invalid URL leaves no product");
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
