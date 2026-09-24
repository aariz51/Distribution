import { randomUUID } from "node:crypto";
import { and, assets, closeDb, eq, getDb } from "@distribution/db";
import { saveGeneratedAsset } from "../packages/pipelines/src/generated-assets";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  try {
    const existing = (await db.select().from(assets).where(and(eq(assets.projectId, "5b433aab-0520-4980-9aed-1e1a2343fa24"), eq(assets.type, "clip"))))[0]!;
    if (!existing) throw new Error("Real clip fixture missing");
    const ids = await Promise.all(Array.from({ length: 8 }, () => saveGeneratedAsset(db, { ...existing, id: randomUUID() })));
    if (new Set(ids).size !== 1 || ids[0] !== existing.id) throw new Error("concurrent retries changed asset identity");
    const rows = await db.select().from(assets).where(and(eq(assets.productId, existing.productId), eq(assets.storageKey, existing.storageKey)));
    if (rows.length !== 1) throw new Error("concurrent retries created duplicate assets");
    console.log("PASS: eight concurrent registrations retain one real clip and its original ID");
  } finally { await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
