import { z } from "zod";
import { createSessionCookie, loginWithPassword } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { clientAddress, limitAttempts } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = handler(async (req) => {
  const body = Body.parse(await req.json());
  limitAttempts(`login:${clientAddress(req)}`, 20, 10 * 60_000);
  limitAttempts(`login-email:${body.email.toLowerCase()}`, 10, 10 * 60_000);
  const session = await loginWithPassword(body.email, body.password);
  if (!session) return json({ error: "Email or password is incorrect." }, { status: 401 });
  await createSessionCookie(session);
  return json({ ok: true, email: session.email });
});
