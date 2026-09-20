import { clearSessionCookie } from "@/lib/auth";
import { handler, json } from "@/lib/api";

export const POST = handler(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
