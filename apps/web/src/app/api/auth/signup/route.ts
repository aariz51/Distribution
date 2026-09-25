import { z } from "zod";
import { createSessionCookie, signUp } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { clientAddress, limitAttempts } from "@/lib/rate-limit";

const Body = z.object({
  email: z.email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  workspace: z.string().trim().min(1, "Name your workspace.").max(80),
});

export const POST = handler(async (req) => {
  limitAttempts(`signup:${clientAddress(req)}`, 5, 60 * 60_000);
  const body = Body.parse(await req.json());
  const session = await signUp(body);
  await createSessionCookie(session);
  return json({ ok: true, email: session.email }, { status: 201 });
});
