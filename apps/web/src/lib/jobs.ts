import { db, eq, jobs, sql } from "./db";
import { NotFound } from "./api";

/** Resolve tenancy from the job's canonical product or owning resource. */
export async function getOwnedJob(accountId: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new NotFound("job");
  const row = (await db.select().from(jobs).where(sql`${eq(jobs.id, id)} and exists (
    select 1 from products p where p.account_id = ${accountId} and p.id = coalesce(
      ${jobs.productId},
      (select product_id from projects where id = ${jobs.projectId}),
      (select product_id from assets where id = ${jobs.assetId}),
      (select product_id from source_videos where id = ${jobs.sourceId})
    )
  )`).limit(1))[0];
  if (!row) throw new NotFound("job");
  return row;
}
