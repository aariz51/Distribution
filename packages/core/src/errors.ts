/** Errors carry a `retrySafe` flag so the job layer knows whether re-running
 *  the step can help (transient network, rate limit) or not (bad input). */
export class PipelineError extends Error {
  readonly retrySafe: boolean;
  readonly step: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  constructor(
    message: string,
    opts: { retrySafe?: boolean; step?: string | undefined; details?: Record<string, unknown> | undefined; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "PipelineError";
    this.retrySafe = opts.retrySafe ?? false;
    this.step = opts.step;
    this.details = opts.details;
  }
}

export class ValidationError extends PipelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { retrySafe: false, details });
    this.name = "ValidationError";
  }
}

export class BudgetExceededError extends PipelineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { retrySafe: false, details });
    this.name = "BudgetExceededError";
  }
}

export function isRetrySafe(err: unknown): boolean {
  return err instanceof PipelineError ? err.retrySafe : false;
}
