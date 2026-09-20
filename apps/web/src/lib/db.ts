import "./env";
import { getDb } from "@distribution/db";

export const db = getDb();
export * from "@distribution/db";
