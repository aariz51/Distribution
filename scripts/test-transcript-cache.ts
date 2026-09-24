import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getDb, closeDb, transcripts, eq } from "@distribution/db";
import { latestTranscript } from "../packages/pipelines/src/shorts/common";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const base = (await db.select().from(transcripts).limit(1))[0];
  if (!base) throw new Error("Real QA transcript required");
  const cacheKey = `qa-${randomUUID()}`;
  const rows = Array.from({ length: 55 }, (_, i) => ({ ...base, id: randomUUID(), cacheKey, createdAt: new Date(Date.now() + i * 1000) }));
  try {
    await db.insert(transcripts).values(rows);
    const found = await latestTranscript(db, base.sourceId, cacheKey);
    if (found?.id !== rows[54]!.id) throw new Error("Did not select newest matching transcript beyond 50 rows");
    if (await latestTranscript(db, base.sourceId, `${cacheKey}-changed`)) throw new Error("Reused incompatible transcript");
    console.log("PASS: actual database selects newest compatible transcript and rejects changed cache identity");
  } finally {
    await db.delete(transcripts).where(eq(transcripts.cacheKey, cacheKey));
    await closeDb();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
