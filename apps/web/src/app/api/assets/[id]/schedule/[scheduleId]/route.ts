import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { cancelSchedule, reconcileSchedule } from "@/lib/publishing";

type Ctx = { params: Promise<{ id: string; scheduleId: string }> };

export const DELETE = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id, scheduleId } = await ctx.params;
  await cancelSchedule(s.accountId, scheduleId, id);
  return json({ ok: true });
});

export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id, scheduleId } = await ctx.params;
  const body = z.object({ postId: z.string().trim().min(1).max(200) }).parse(await req.json());
  return json(await reconcileSchedule(session.accountId, scheduleId, id, body.postId));
});
