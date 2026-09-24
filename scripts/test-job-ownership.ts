import "dotenv/config";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { and, closeDb, eq, getDb, jobs, products, users } from "@distribution/db";
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
async function main() {
  const { SignJWT } = await import(requireWeb.resolve("jose"));
  const db = getDb();
  try {
    const product = (await db.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
    const user = (await db.select().from(users).where(eq(users.accountId, product.accountId)))[0]!;
    const job = (await db.select().from(jobs).where(and(eq(jobs.productId, product.id), eq(jobs.status, "completed"))))[0]!;
    for (const accountId of [product.accountId, randomUUID()]) {
      const jwt = await new SignJWT({ accountId, email: user.email }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setExpirationTime("5m").sign(new TextEncoder().encode(process.env.APP_SECRET!));
      for (const action of ["cancel", "retry"]) {
        const response = await fetch(`http://localhost:3000/api/jobs/${job.id}`, { method: "POST", headers: { cookie: `dist_session=${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ action }) });
        const expected = accountId === product.accountId ? 400 : 404;
        if (response.status !== expected) throw new Error(`${action}: expected ${expected}, got ${response.status}`);
      }
      for (const suffix of ["", "/events"]) {
        const res = await fetch(`http://localhost:3000/api/jobs/${job.id}${suffix}`, { headers: { cookie: `dist_session=${jwt}` } });
        if (accountId === product.accountId && suffix === "/events" && res.body) {
          const reader = res.body.getReader();
          const first = await reader.read();
          const text = new TextDecoder().decode(first.value);
          const match = /^id: (\d+)$/m.exec(text);
          await reader.cancel();
          if (!match) throw new Error("event stream did not provide a resume cursor");
          const cursor = Number(match[1]);
          const resumed = await fetch(`http://localhost:3000/api/jobs/${job.id}/events`, { headers: { cookie: `dist_session=${jwt}`, "last-event-id": String(cursor) } });
          const resumeReader = resumed.body!.getReader();
          const next = new TextDecoder().decode((await resumeReader.read()).value);
          await resumeReader.cancel();
          const nextId = /^id: (\d+)$/m.exec(next);
          if (nextId && Number(nextId[1]) <= cursor) throw new Error("resumed stream replayed an acknowledged event");
        } else await res.body?.cancel();
        const expected = accountId === product.accountId ? 200 : 404;
        if (res.status !== expected) throw new Error(`${suffix || "detail"}: expected ${expected}, got ${res.status}`);
      }
    }
    console.log("PASS: owner can read job/status stream; unrelated account gets 404 on both");
  } finally { await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
