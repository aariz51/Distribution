import { z } from "zod";
import { RightsClass, ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { and, db, eq, jobs, sourceVideos, sql } from "@/lib/db";
import { getProduct } from "@/lib/products";
const Body = z.object({ rights: RightsClass, confirmed: z.boolean().default(false), explanation: z.string().trim().max(4000).optional() });
type Ctx = { params: Promise<{ id: string; sourceId: string }> };
export const PATCH = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id: productId, sourceId } = await ctx.params;
  await getProduct(session.accountId, productId);
  const body = Body.parse(await req.json());
  if (body.rights !== "unknown" && !body.confirmed) throw new ValidationError("Confirm your rights to use this source");
  if (["licensed", "third_party_attested"].includes(body.rights) && (!body.explanation || body.explanation.length < 10)) throw new ValidationError("Describe the license or permission that allows this use");
  await db.transaction(async tx => {
    const lease = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`source-processing:${sourceId}`}, 0)) as locked`);
    if (!lease.rows[0]?.locked) throw new ValidationError("Wait for source processing to finish before changing rights");
    const source = (await tx.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))).for("update"))[0];
    if (!source) throw new NotFound("source");
    const active = await tx.select({ id: jobs.id }).from(jobs).where(and(sql`(${jobs.sourceId} = ${sourceId} or ${jobs.payload}->>'sourceId' = ${sourceId} or ${jobs.projectId} in (select id from projects where source_id = ${sourceId}))`, sql`${jobs.status} in ('queued', 'started', 'progress', 'retrying')`)).limit(1);
    if (active.length) throw new ValidationError("Wait for queued processing to finish or cancel it before changing rights");
    await tx.update(sourceVideos).set({ rights: body.rights, attestation: body.rights === "unknown" ? null : { text: body.explanation ?? "I confirm I own this source and have rights to use it.", rights: body.rights, userId: session.userId, at: new Date().toISOString() }, updatedAt: sql`now()` }).where(eq(sourceVideos.id, sourceId));
  });
  return json({ sourceId, rights: body.rights });
});
