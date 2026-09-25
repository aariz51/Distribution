import type { ProviderBudget } from "@distribution/core/provider-budget";
import { BudgetExceededError, newId } from "@distribution/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { accounts, budgetReservations, limits, products, usageLedger } from "./schema/index";

/** Reservations count against the UTC monthly estimate cap until confirmed or reconciled. */
export function productBudget(db: Db, productId: string, jobId: string): ProviderBudget {
  return {
    async run<T>(estimatedUsd: number, work: () => Promise<T>): Promise<T> {
      if (estimatedUsd === 0) return work();
      const id = newId();
      await db.transaction(async tx => {
        const month = sql`date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`;
        // Workspace cap first (lock order: account, then product). Without it a
        // signed-up workspace could multiply its allowance by adding products.
        const owner = (await tx.select({ accountId: products.accountId, isOwner: accounts.isOwner }).from(products).innerJoin(accounts, eq(accounts.id, products.accountId)).where(eq(products.id, productId)))[0];
        if (owner) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget-account:${owner.accountId}`}, 0))`);
          const accountLimit = (await tx.select().from(limits).where(and(eq(limits.scope, "account"), eq(limits.scopeId, owner.accountId), eq(limits.key, "usd_month"))))[0];
          const accountCap = accountLimit?.value ?? (owner.isOwner ? Number.POSITIVE_INFINITY : Number(process.env.DEFAULT_ACCOUNT_MONTHLY_USD ?? 10));
          if (Number.isNaN(accountCap) || accountCap < 0) throw new BudgetExceededError("Invalid workspace budget configuration");
          if (Number.isFinite(accountCap)) {
            const inAccount = sql`${products.accountId} = ${owner.accountId}`;
            const used = (await tx.select({ total: sql<number>`coalesce(sum(${usageLedger.usdEstimate}), 0)` }).from(usageLedger).innerJoin(products, eq(products.id, usageLedger.productId)).where(and(inAccount, sql`${usageLedger.at} >= ${month}`)))[0]!;
            const held = (await tx.select({ total: sql<number>`coalesce(sum(${budgetReservations.usdEstimate}), 0)` }).from(budgetReservations).innerJoin(products, eq(products.id, budgetReservations.productId)).where(and(inAccount, sql`${budgetReservations.createdAt} >= ${month}`)))[0]!;
            const committed = Number(used.total) + Number(held.total);
            if (committed + estimatedUsd > accountCap + 1e-9) throw new BudgetExceededError(`Monthly workspace budget exceeded: $${committed.toFixed(2)} used or reserved of $${accountCap.toFixed(2)}; this call needs up to $${estimatedUsd.toFixed(2)} estimated`, { accountId: owner.accountId, cap: accountCap, committed, estimatedUsd });
          }
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`budget:${productId}`}, 0))`);
        const limit = (await tx.select().from(limits).where(and(eq(limits.scope, "product"), eq(limits.scopeId, productId), eq(limits.key, "usd_month"))))[0];
        const cap = limit?.value ?? Number(process.env.DEFAULT_PRODUCT_MONTHLY_USD ?? 25);
        if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new BudgetExceededError("Invalid provider budget configuration");
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
