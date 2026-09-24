import type { ProviderBudget } from "@distribution/core/provider-budget";
import { BudgetExceededError, newId } from "@distribution/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { budgetReservations, limits, usageLedger } from "./schema/index";

/** Reservations count against the UTC monthly estimate cap until confirmed or reconciled. */
export function productBudget(db: Db, productId: string, jobId: string): ProviderBudget {
  return {
    async run<T>(estimatedUsd: number, work: () => Promise<T>): Promise<T> {
      if (estimatedUsd === 0) return work();
      const id = newId();
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget:${productId}`}, 0))`);
        const limit = (await tx.select().from(limits).where(and(eq(limits.scope, "product"), eq(limits.scopeId, productId), eq(limits.key, "usd_month"))))[0];
        const cap = limit?.value ?? Number(process.env.DEFAULT_PRODUCT_MONTHLY_USD ?? 25);
        if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new BudgetExceededError("Invalid provider budget configuration");
        const month = sql`date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`;
        const usage = (await tx.select({ total: sql<number>`coalesce(sum(${usageLedger.usdEstimate}), 0)` }).from(usageLedger).where(and(eq(usageLedger.productId, productId), sql`${usageLedger.at} >= ${month}`)))[0]!;
        const held = (await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.usdEstimate}), 0)` }).from(budgetReservations).where(and(eq(budgetReservations.productId, productId), sql`${budgetReservations.createdAt} >= ${month}`)))[0]!;
        const committed = Number(usage.total) + Number(held.total);
        if (committed + estimatedUsd > cap + 1e-9) throw new BudgetExceededError(`Monthly provider budget exceeded: $${committed.toFixed(2)} used or reserved of $${cap.toFixed(2)}; this call needs up to $${estimatedUsd.toFixed(2)} estimated`, { productId, cap, committed, estimatedUsd });
        await tx.insert(budgetReservations).values({ id, productId, jobId, usdEstimate: estimatedUsd });
      });
      try {
        const result = await work(); // Provider records usage before returning.
        await db.delete(budgetReservations).where(eq(budgetReservations.id, id));
        return result;
      } catch (error) {
        // Transport failures can still be billed. Keep the conservative hold.
        await db.update(budgetReservations).set({ state: "uncertain" }).where(eq(budgetReservations.id, id));
        throw error;
      }
    },
  };
}
