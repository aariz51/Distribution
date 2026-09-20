import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { refreshChannels } from "@/lib/publishing";

type Ctx = { params: Promise<{ id: string }> };

/** Calls Postiz. Only ever triggered by an explicit click. */
export const POST = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  return json({ channels: await refreshChannels(s.accountId, id) });
});
