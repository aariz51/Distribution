import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://localhost:5432/distribution";
}

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl(), max: Number(process.env.PG_POOL_MAX ?? 10) });
  }
  return pool;
}

export type Db = ReturnType<typeof createDb>;

export function createDb(p: pg.Pool = getPool()) {
  return drizzle({ client: p, schema, casing: "snake_case" });
}

let db: Db | undefined;
export function getDb(): Db {
  if (!db) db = createDb();
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
