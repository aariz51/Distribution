import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { createConnection, getOrCreateConnection, listConnections } from "@/lib/publishing";

const Body = z.object({ label: z.string().min(1).max(80).default("Default"), apiUrl: z.url().optional(), apiKey: z.string().min(8) });

export const GET = handler(async () => {
  const s = await requireSession();
  // Adopts POSTIZ_API_KEY once if nothing is stored, so the key stops living only in env.
  await getOrCreateConnection(s.accountId);
  return json({ connections: await listConnections(s.accountId) });
});

export const POST = handler(async (req) => {
  const s = await requireSession();
  const body = Body.parse(await req.json());
  const connection = await createConnection(s.accountId, body);
  return json({ connection }, { status: 201 });
});
