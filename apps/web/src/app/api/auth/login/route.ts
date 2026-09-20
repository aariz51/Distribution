import { z } from "zod";
import { createSessionCookie, loginWithPassword } from "@/lib/auth";
import { handler, json } from "@/lib/api";

const Body = z.object({ email: z.string().trim().min(3).max(200).default("founder@local"), password: z.string().min(1) });

export const POST = handler(async (req) => {
  const body = Body.parse(await req.json());
  const session = await loginWithPassword(body.email, body.password);
  if (!session) return json({ error: "invalid credentials" }, { status: 401 });
  await createSessionCookie(session);
  return json({ ok: true, email: session.email });
});
