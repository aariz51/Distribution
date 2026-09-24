import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, assetCopy, candidates, closeDb, eq, features, getDb, products, projects } from "@distribution/db";
import { loadProfile } from "../packages/pipelines/src/shorts/common";
import { reconcileShortsProject } from "../packages/pipelines/src/shorts/completion";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  try {
    const baseProject = (await db.select().from(projects).where(eq(projects.id, "5b433aab-0520-4980-9aed-1e1a2343fa24")))[0]!;
    const baseProduct = (await db.select().from(products).where(eq(products.id, baseProject.productId)))[0]!;
    const baseCandidate = (await db.select().from(candidates).where(eq(candidates.projectId, baseProject.id)))[0]!;
    const baseAssets = await db.select().from(assets).where(eq(assets.projectId, baseProject.id));
    const baseClip = baseAssets.find(a => a.type === "clip" && a.candidateId === baseCandidate.id)!;
    const baseEnriched = baseAssets.find(a => a.type === "clip_enriched" && a.derivedFromAssetId === baseClip.id)!;
    const copy = (await db.select().from(assetCopy).where(eq(assetCopy.assetId, baseClip.id))).find(c => c.platform === "instagram")!;
    const productId = randomUUID(), projectId = randomUUID(), candidateId = randomUUID(), clipId = randomUUID();
    const featureRows = await db.select().from(features).where(eq(features.productId, baseProduct.id));
    await db.insert(products).values({ ...baseProduct, id: productId, slug: `snapshot-${productId}`, version: 1, contentPreferences: { ...baseProduct.contentPreferences, broll: false, sfx: true, outro: false }, publishing: { ...baseProduct.publishing, cadence: [{ channelId: "qa", platform: "instagram", perWeek: 1, windows: [] }] } });
    await db.insert(features).values(featureRows.map(f => ({ ...f, id: randomUUID(), productId })));
    const snapshot = await loadProfile(db, productId);
    await db.insert(projects).values({ ...baseProject, id: projectId, productId, profileVersion: 1, status: "running", params: { profileSnapshot: snapshot } });
    await db.insert(candidates).values({ ...baseCandidate, id: candidateId, projectId, selected: true });
    await db.insert(assets).values({ ...baseClip, id: clipId, productId, projectId, candidateId, jobId: null });
    await db.insert(assetCopy).values({ ...copy, id: randomUUID(), assetId: clipId });
    await db.update(products).set({ version: 2, contentPreferences: { ...snapshot.contentPreferences, sfx: false, broll: true, outro: true }, publishing: { ...snapshot.publishing, cadence: [] }, brand: { ...snapshot.brand, cta: "changed after start" } }).where(eq(products.id, productId));
    const loaded = await loadProfile(db, productId, projectId);
    if (loaded.version !== 1 || loaded.brand.cta !== snapshot.brand.cta || !loaded.contentPreferences.sfx || loaded.contentPreferences.broll || loaded.publishing.cadence.length !== 1) throw new Error("Run consumed mutable product settings");
    await reconcileShortsProject(db, productId, projectId);
    if ((await db.select().from(projects).where(eq(projects.id, projectId)))[0]!.status !== "running") throw new Error("Completed before requested enrichment");
    await db.insert(assets).values({ ...baseEnriched, id: randomUUID(), productId, projectId, candidateId, derivedFromAssetId: clipId, jobId: null });
    await reconcileShortsProject(db, productId, projectId);
    if ((await db.select().from(projects).where(eq(projects.id, projectId)))[0]!.status !== "completed") throw new Error("New preferences prevented completion of original contract");
    let rejected = false;
    try { await loadProfile(db, baseProduct.id, projectId); } catch { rejected = true; }
    if (!rejected) throw new Error("Foreign project snapshot accepted");
    console.log("PASS: real DB run preserves original preferences/brand/platforms after edits, waits for enrichment, completes original contract and rejects foreign project");
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
