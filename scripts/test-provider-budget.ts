import { randomUUID } from "node:crypto";
import { BudgetExceededError } from "@distribution/core";
import { budgetReservations, closeDb, eq, getDb, limits, productBudget, products, usageLedger } from "@distribution/db";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  const db = getDb(); const productId = randomUUID();
  const original = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
  await db.insert(products).values({ ...original, id: productId, slug: `budget-${productId}` });
  await db.insert(limits).values({ id: randomUUID(), scope: "product", scopeId: productId, key: "usd_month", value: 1 });
  try {
    let release!: () => void, rejectedAll!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const denied = new Promise<void>(r => { rejectedAll = r; });
    let rejected = 0, executed = 0;
    const runs = Array.from({ length: 8 }, async () => {
      const jobId = randomUUID();
      try {
        await productBudget(db, productId, jobId).run(0.6, async () => {
          executed++; await gate;
          await db.insert(usageLedger).values({ accountId: original.accountId, productId, jobId, provider: "budget-test", kind: "chat", usdEstimate: 0.55 });
        });
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
        if (++rejected === 7) rejectedAll();
      }
    });
    await Promise.race([denied, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("Concurrent budget test timed out")), 10000); timer.unref(); })]);
    release(); await Promise.all(runs);
    if (executed !== 1 || rejected !== 7) throw new Error("Concurrent calls exceeded available reservation budget");
    if ((await db.select().from(budgetReservations).where(eq(budgetReservations.productId, productId))).length) throw new Error("Successful usage retained reservation");
    try { await productBudget(db, productId, randomUUID()).run(0.2, async () => { throw new Error("uncertain provider failure"); }); } catch { /* expected */ }
    const held = await db.select().from(budgetReservations).where(eq(budgetReservations.productId, productId));
    if (held.length !== 1 || held[0]!.state !== "uncertain") throw new Error("Uncertain spend was discarded");
    let invoked = false;
    try { await productBudget(db, productId, randomUUID()).run(0.3, async () => { invoked = true; }); } catch (error) { if (!(error instanceof BudgetExceededError)) throw error; }
    if (invoked) throw new Error("Call ignored uncertain reservation");
    console.log("PASS: eight concurrent calls permit one reservation; confirmed usage replaces hold; uncertain failures retain budget and block excess calls");
  } finally { await closeDb(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
