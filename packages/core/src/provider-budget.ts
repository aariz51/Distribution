import { AsyncLocalStorage } from "node:async_hooks";
import { BudgetExceededError } from "./errors";
export interface ProviderBudget {
  run<T>(estimatedUsd: number, work: () => Promise<T>): Promise<T>;
}
const scope = new AsyncLocalStorage<ProviderBudget>();
export function withProviderBudget<T>(budget: ProviderBudget, work: () => Promise<T>): Promise<T> {
  return scope.run(budget, work);
}
export function withProviderSpend<T>(estimatedUsd: number, work: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new BudgetExceededError("Cannot reserve provider budget without a valid cost estimate");
  return scope.getStore()?.run(estimatedUsd, work) ?? work();
}
