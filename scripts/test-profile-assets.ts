import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "@distribution/db";
import { loadProfile } from "../packages/pipelines/src/shorts/common";
import { profileAssets } from "../packages/pipelines/src/profile-assets";

async function main() {
  const db = getDb();
  try {
    const profile = await loadProfile(db, "6cc41ef3-7761-4520-b843-361ce1b8bca7");
    const saved = structuredClone(profile);
    saved.brand.screenshotAssetIds.reverse();
    const resolved = await profileAssets(db, saved);
    if (resolved.logo?.id !== saved.brand.logoAssetId || resolved.screenshots.map(s => s.id).join() !== saved.brand.screenshotAssetIds.join()) throw new Error("Saved image selection/order changed");
    const noScreens = await profileAssets(db, { ...saved, brand: { ...saved.brand, screenshotAssetIds: [] } });
    if (noScreens.screenshots.length) throw new Error("Included images outside saved profile");
    let rejected = false;
    try { await profileAssets(db, { ...saved, id: randomUUID() }); } catch { rejected = true; }
    if (!rejected) throw new Error("Accepted another product's images");
    console.log(`PASS: real SafeChoice logo and ${resolved.screenshots.length} images resolve in saved order; unselected and foreign images excluded`);
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
