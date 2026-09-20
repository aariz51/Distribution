import pino from "pino";

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /pos_[A-Za-z0-9_-]{8,}/g,
  /(?<=Bearer )[A-Za-z0-9._-]{8,}/g,
  /(?<=[?&]key=)[^&\s]+/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
];

/** Strip anything that looks like a credential from free text before it is
 *  logged, stored on a job, or shown in the UI. Port of `openrouter.rs redact`
 *  widened to the other providers. */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["*.apiKey", "*.authorization", "*.password", "req.headers.authorization", "*.token"],
    censor: "[redacted]",
  },
  base: { service: process.env.SERVICE_NAME ?? "distribution" },
  formatters: { level: (label) => ({ level: label }) },
  hooks: {
    logMethod(args, method) {
      const cleaned = args.map((a) => (typeof a === "string" ? redact(a) : a));
      return method.apply(this, cleaned as Parameters<typeof method>);
    },
  },
});

export type Logger = typeof logger;
