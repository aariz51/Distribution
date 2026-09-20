import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { closeDb, createDb, getPool } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const db = createDb(getPool());
  await migrate(db, { migrationsFolder: path.join(here, "..", "drizzle") });
  await closeDb();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
