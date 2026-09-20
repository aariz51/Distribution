import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getOrCreateConnection, listChannels } from "@/lib/publishing";

export const GET = handler(async () => {
  const s = await requireSession();
  await getOrCreateConnection(s.accountId);
  return json({ channels: await listChannels(s.accountId) });
});
