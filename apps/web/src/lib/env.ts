import { config } from "dotenv";
import path from "node:path";

// Next.js loads .env from the app dir; ours lives at the repo root.
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
process.env.SERVICE_NAME ??= "web";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
