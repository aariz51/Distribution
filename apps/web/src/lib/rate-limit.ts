/**
 * Fixed-window attempt limiter for the unauthenticated endpoints (sign-in and
 * sign-up), keyed by client address. It lives in process memory, which matches
 * how the web app runs: one Node process in front of Postgres. A multi-instance
 * deployment would move this into Postgres or a shared cache.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export class RateLimited extends Error {
  constructor(readonly retryAfterSec: number) {
    super("too many attempts");
    this.name = "RateLimited";
  }
}

export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function limitAttempts(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  w.count += 1;
  if (w.count > max) throw new RateLimited(Math.ceil((w.resetAt - now) / 1000));
}
