import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { channelConnectUrl } from "@/lib/publishing";

type Ctx = { params: Promise<{ provider: string }> };

/**
 * Returns the provider's sign-in page for adding a channel. POST rather than
 * GET because Postiz opens an OAuth session for it; a crawler or prefetch must
 * never start one.
 */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { provider } = await ctx.params;
  const refresh = new URL(req.url).searchParams.get("refresh") ?? undefined;
  return json({ url: await channelConnectUrl(s.accountId, provider, refresh) });
});
