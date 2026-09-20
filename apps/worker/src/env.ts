import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (gitignored) so web and worker share one config file.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env"), quiet: true });
process.env.SERVICE_NAME ??= "worker";
