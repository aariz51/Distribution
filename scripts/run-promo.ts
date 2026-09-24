import { loadProfile } from "../packages/pipelines/src/shorts/common";
/**
 * End-to-end promo run, deterministic path: no LLM, no API key.
 *   pnpm exec tsx scripts/run-promo.ts <productId> [durationSec]
 * Registers only the promo handlers and drains them, so nothing else in the
 * queue can start while this runs.
 */
import "./_env";
import { closeDb, eq, getDb, jobs, projects, products, sql } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { registerPromo } from "@distribution/pipelines";
import { newId } from "@distribution/core";

async function main() {
  const productId = process.argv[2];
  const durationSec = Number(process.argv[3] ?? 24);
  const referenceId = process.argv[4];
  if (!productId) throw new Error("usage: run-promo.ts <productId> [durationSec]");
  const db = getDb();
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) throw new Error(`no product ${productId}`);

  const profileSnapshot = await loadProfile(db, productId);
  const projectId = newId();
  await db.insert(projects).values({ id: projectId, productId, kind: "promo", referenceId, profileVersion: product.version, params: { durationSec, profileSnapshot, ...(referenceId ? { referenceId, useLlm: true } : {}) }, status: "running" });
  console.log(`project ${projectId} for ${product.slug} (${durationSec}s)`);

  const queue = await JobQueue.start(db);
  registerPromo(queue);
  await queue.work(["llm", "render", "media"]);
  await queue.enqueue("promo.run", { productId, projectId, durationSec, ...(referenceId ? { referenceId } : {}) }, { productId, projectId, singletonKey: `promo.run:${projectId}` });

  const started = Date.now();
  let lastLine = "";
  for (;;) {
    const rows = await db.select({ type: jobs.type, status: jobs.status, pct: jobs.progressPct, step: jobs.currentStep, err: jobs.error }).from(jobs).where(eq(jobs.projectId, projectId));
    const line = rows.map((r) => `${r.type.replace("promo.", "")}:${r.status}${r.status === "progress" ? ` ${r.pct}% ${r.step ?? ""}` : ""}`).join("  ");
    if (line !== lastLine) {
      console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${line}`);
      lastLine = line;
    }
    const failed = rows.filter((r) => r.status === "failed");
    if (failed.length) {
      process.exitCode = 1;
      console.error("FAILED:", JSON.stringify(failed.map((f) => f.err), null, 2));
      break;
    }
    const done = rows.some(r => r.type === "promo.finalize" && r.status === "completed") && rows.every(r => r.status === "completed");
    if (done) {
      console.log("all promo jobs completed");
      break;
    }
    if (Date.now() - started > 25 * 60_000) {
      process.exitCode = 1;
      console.error("timed out");
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const out = await db.execute(sql`select type, status, width, height, round(duration_sec::numeric,1) as dur, size_bytes, storage_key from assets where project_id = ${projectId} order by created_at`);
  console.table(out.rows);
  await queue.stop();
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
