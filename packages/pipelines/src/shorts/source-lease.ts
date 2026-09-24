import { createDedicatedClient } from "@distribution/db";
import { PipelineError } from "@distribution/core";
import type { JobContext, JobTypeName } from "@distribution/jobs";

/** A session lease survives job cancellation until subprocess cleanup and final writes finish. */
export async function withSourceLease<T>(ctx: JobContext<JobTypeName>, sourceId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const connection = createDedicatedClient(ctx.db);
  const lost = new AbortController();
  connection.on("error", error => lost.abort(error));
  const signal = AbortSignal.any([ctx.signal, lost.signal]);
  const key = `source-processing:${sourceId}`;
  let locked = false;
  try {
    await connection.connect();
    signal.throwIfAborted();
    const result = await connection.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [key]);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new PipelineError("Source processing is still stopping or running; retrying after its lease is released", { retrySafe: true, step: "source_lease" });
    // The app can cancel before this handler acquires the lease or its abort poll fires.
    const job = await connection.query<{ status: string }>("select status from jobs where id = $1", [ctx.jobId]);
    if (!job.rows[0] || job.rows[0].status === "cancelled") throw new PipelineError("Job cancelled", { step: "source_lease" });
    signal.throwIfAborted();
    return await work(signal);
  } finally {
    try {
      if (locked) await connection.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]);
    } finally {
      await connection.end();
    }
  }
}
