import { PipelineError, redact } from "@distribution/core";

export const CONNECT_TIMEOUT_MS = 20_000;
export const TOTAL_TIMEOUT_MS = 300_000;
export const MAX_ATTEMPTS = 5;

/** Mirrors autoshorts openrouter.rs is_retryable: 408/409/429/5xx and transport errors. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Retry-After (seconds or HTTP date) capped at 120 s, else exponential 2^(attempt+1) capped at 60 s. */
export function backoffSecs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const n = Number(retryAfter);
    if (Number.isFinite(n) && n >= 0) return Math.min(120, n);
    const t = Date.parse(retryAfter);
    if (!Number.isNaN(t)) return Math.max(0, Math.min(120, (t - Date.now()) / 1000));
  }
  return Math.min(60, 2 ** (attempt + 1));
}

export class ProviderHttpError extends PipelineError {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfter: string | null,
    provider: string,
  ) {
    super(`${provider} HTTP ${status}: ${redact(body).slice(0, 300)}`, { retrySafe: isRetryableStatus(status), details: { status, provider } });
    this.name = "ProviderHttpError";
  }
}

export interface FetchJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  provider: string;
  /** Called on a non-retryable 4xx; return a modified body to retry once (e.g. drop response_format). */
  onBadRequest?: (body: string) => unknown | undefined;
  /** at most MAX_ATTEMPTS */
  maxAttempts?: number;
  log?: { warn: (o: object, m?: string) => void };
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PipelineError("cancelled", { retrySafe: false }));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      reject(new PipelineError("cancelled", { retrySafe: false }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** POST JSON with the shared retry/timeout policy. Returns parsed JSON and attempt count. */
export async function postJsonWithRetry<T>(opts: FetchJsonOptions): Promise<{ data: T; attempts: number }> {
  let body = opts.body;
  let adjusted = false;
  let lastErr: unknown;
  const maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, opts.maxAttempts ?? MAX_ATTEMPTS));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new PipelineError("cancelled", { retrySafe: false });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("total timeout")), TOTAL_TIMEOUT_MS);
    const onAbort = () => ctrl.abort(new Error("cancelled"));
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...opts.headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.ok) {
        // Some gateways return HTTP 200 with an error object (OpenRouter does this).
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new ProviderHttpError(502, `non-JSON body: ${text.slice(0, 120)}`, null, opts.provider);
        }
        const maybeErr = (parsed as { error?: { message?: string; code?: number } }).error;
        if (maybeErr && !(parsed as { choices?: unknown }).choices && !(parsed as { content?: unknown }).content) {
          const code = Number(maybeErr.code ?? 500);
          throw new ProviderHttpError(isRetryableStatus(code) ? code : 500, maybeErr.message ?? "provider error", null, opts.provider);
        }
        return { data: parsed as T, attempts: attempt + 1 };
      }
      if (res.status === 400 && !adjusted && opts.onBadRequest) {
        const next = opts.onBadRequest(text);
        if (next !== undefined) {
          body = next;
          adjusted = true;
          opts.log?.warn({ provider: opts.provider }, "provider rejected request shape; retrying adjusted body");
          continue;
        }
      }
      const err = new ProviderHttpError(res.status, text, res.headers.get("retry-after"), opts.provider);
      if (!err.retrySafe || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      const wait = backoffSecs(attempt, err.retryAfter);
      opts.log?.warn({ provider: opts.provider, status: res.status, attempt, wait }, "retrying provider call");
      await sleep(wait * 1000, opts.signal);
    } catch (err) {
      if (opts.signal?.aborted) throw new PipelineError("cancelled", { retrySafe: false });
      if (err instanceof ProviderHttpError) {
        if (!err.retrySafe || attempt === maxAttempts - 1) throw err;
        lastErr = err;
        await sleep(backoffSecs(attempt, err.retryAfter) * 1000, opts.signal);
        continue;
      }
      if (opts.signal?.aborted) throw new PipelineError("cancelled", { retrySafe: false });
      // transport error / timeout → retryable
      lastErr = err;
      if (attempt === maxAttempts - 1) break;
      await sleep(backoffSecs(attempt, null) * 1000, opts.signal);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new PipelineError(`${opts.provider}: ${redact(String(lastErr instanceof Error ? lastErr.message : lastErr))}`, { retrySafe: true, cause: lastErr });
}
