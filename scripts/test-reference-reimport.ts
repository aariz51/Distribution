import "dotenv/config";
import { spawn } from "node:child_process";
import { closeDb, eq, getDb, referenceVideos } from "@distribution/db";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const rows = await db.select().from(referenceVideos);
  const target = rows.find(row => row.url.includes("4Leardp_AGc"));
  if (!target) throw new Error("Import real catalog before running this regression");
  try {
    // Model a later curated/cache update, then execute the actual live importer.
    const updatedAnalysis = { ...(target.analysis ?? {}), provenance: { kind: "sampled-video-frames", regressionMarker: "preserve-existing" } };
    await db.update(referenceVideos).set({ analysis: updatedAnalysis, curatorScore: 4, notes: "Later curated note must survive reimport", usageCount: target.usageCount + 1 }).where(eq(referenceVideos.id, target.id));
    const before = (await db.select().from(referenceVideos)).sort((a, b) => a.id.localeCompare(b.id));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("pnpm", ["--filter", "@distribution/scripts", "exec", "tsx", "import-reference-catalog.ts"], { cwd: process.cwd(), stdio: "inherit", env: process.env });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Importer exited ${code}`)));
    });
    const after = (await db.select().from(referenceVideos)).sort((a, b) => a.id.localeCompare(b.id));
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Reference reimport overwrote current catalog data");
    console.log("PASS: live catalog reimport preserves newer analysis, curation, usage, IDs and timestamps exactly");
  } finally {
    await db.update(referenceVideos).set({ analysis: target.analysis, curatorScore: target.curatorScore, notes: target.notes, usageCount: target.usageCount }).where(eq(referenceVideos.id, target.id));
    await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
