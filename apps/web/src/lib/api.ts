import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger, redact, ValidationError } from "@distribution/core";
import { SignupError, UnauthorizedError } from "./auth";
import { RateLimited } from "./rate-limit";

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) return json({ error: "unauthorized" }, { status: 401 });
  if (err instanceof RateLimited) return json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429, headers: { "retry-after": String(err.retryAfterSec) } });
  if (err instanceof SignupError) return json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) return json({ error: "validation", issues: err.issues }, { status: 400 });
  if (err instanceof ValidationError) return json({ error: err.message, details: err.details }, { status: 400 });
  if (err instanceof Error && err.name === "NotFound") return json({ error: "not found" }, { status: 404 });
  if (err instanceof Error && err.name === "PostizError") {
    const status = (err as Error & { status?: number }).status ?? 0;
    const message = status === 401 || status === 403 ? "Postiz rejected this workspace's API key. Reconnect Postiz with a current key." : `Postiz could not complete that request (HTTP ${status}). Try again in a minute.`;
    return json({ error: message }, { status: 502 });
  }
  if (err instanceof Error && (err as Error & { step?: string }).step === "connect") return json({ error: err.message }, { status: 502 });
  logger.error({ err: redact(String(err instanceof Error ? err.stack ?? err.message : err)) }, "api error");
  return json({ error: "internal error" }, { status: 500 });
}

export class NotFound extends Error {
  constructor(what = "resource") {
    super(`${what} not found`);
    this.name = "NotFound";
  }
}

/** Wrap a route handler: session, validation and error mapping in one place. */
export function handler<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
