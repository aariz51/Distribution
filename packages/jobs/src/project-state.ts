import { sql, type Db } from "@distribution/db";

/** Failed/cancelled processing must remain visible at project level. */
export async function reconcileJobProject(db: Pick<Db, "execute">, jobId: string): Promise<void> {
  await db.execute(sql`
    update projects p set status = case
      when exists (
        select 1 from jobs j where (j.project_id = p.id or j.asset_id in (select id from assets where project_id = p.id))
        and j.status = 'failed' and j.result->>'retryJobId' is null
      ) then 'failed'::project_status
      when exists (
        select 1 from jobs j where (j.project_id = p.id or j.asset_id in (select id from assets where project_id = p.id))
        and j.status = 'cancelled' and j.result->>'retryJobId' is null
      ) then 'cancelled'::project_status
      when p.status in ('failed','cancelled') then 'running'::project_status
      else p.status end,
      updated_at = now()
    where p.id = (select coalesce(j.project_id, a.project_id) from jobs j left join assets a on a.id = j.asset_id where j.id = ${jobId})
  `);
}
