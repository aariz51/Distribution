import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { cancelSchedule } from "@/lib/publishing";

type Ctx = { params: Promise<{ id: string; scheduleId: string }> };

export const DELETE = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { scheduleId } = await ctx.params;
  await cancelSchedule(s.accountId, scheduleId);
  return json({ ok: true });
});
