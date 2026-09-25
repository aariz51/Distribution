import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { removeChannel } from "@/lib/publishing";

type Ctx = { params: Promise<{ channelId: string }> };

/** Disconnects a channel from the workspace's Postiz organisation. */
export const DELETE = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { channelId } = await ctx.params;
  return json({ channels: await removeChannel(s.accountId, channelId) });
});
