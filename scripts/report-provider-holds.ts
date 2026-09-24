/** Read-only operational report. Never releases an uncertain provider charge. */
import "dotenv/config";
import { and, budgetReservations, closeDb, eq, getDb, jobs, products, usageLedger } from "@distribution/db";
async function main() {
  const productId = process.argv[2];
  if (!productId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(productId)) throw new Error("Supply a product UUID");
  const db = getDb();
  try {
    const product = (await db.select({ id: products.id, name: products.product }).from(products).where(eq(products.id, productId)))[0];
    if (!product) throw new Error("Product not found");
    const holds = await db.select().from(budgetReservations).where(eq(budgetReservations.productId, productId));
    const report = [];
    for (const hold of holds) {
      const job = (await db.select({ status: jobs.status, type: jobs.type, step: jobs.currentStep }).from(jobs).where(eq(jobs.id, hold.jobId)))[0];
      const usage = await db.select({ provider: usageLedger.provider, model: usageLedger.model, kind: usageLedger.kind, purpose: usageLedger.purpose, usdEstimate: usageLedger.usdEstimate, at: usageLedger.at }).from(usageLedger).where(and(eq(usageLedger.productId, productId), eq(usageLedger.jobId, hold.jobId)));
      report.push({ reservationId: hold.id, jobId: hold.jobId, state: hold.state, heldUsdEstimate: hold.usdEstimate, createdAt: hold.createdAt, job: job ?? null, jobUsage: usage, action: job && ["queued", "started", "progress", "retrying"].includes(job.status) ? "Job may still be calling a provider. Do not release." : "Reconcile against provider billing and existing job usage before adjusting. This report cannot establish the actual charge." });
    }
    console.log(JSON.stringify({ productId, product: product.name.name, reservationCount: report.length, heldUsdEstimate: holds.reduce((sum, hold) => sum + hold.usdEstimate, 0), reservations: report }, null, 2));
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
