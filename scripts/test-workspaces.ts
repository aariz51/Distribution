import "./_env.js";
import { BudgetExceededError, newId } from "@distribution/core";
import { accounts, closeDb, eq, getDb, inArray, limits, productBudget, products, users } from "@distribution/db";

/**
 * Self-serve workspace acceptance against a running web app (APP_URL, default
 * http://localhost:3000) and its database. Creates throwaway workspaces and
 * removes them afterwards.
 *
 *   pnpm exec tsx scripts/test-workspaces.ts
 */
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const db = getDb();
const created: string[] = [];
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" });
  const setCookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { status: res.status, cookie: setCookie, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function get(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

async function signup(tag: string) {
  const email = `qa.${tag}.${Date.now()}@example.com`;
  const r = await post("/api/auth/signup", { workspace: `QA ${tag}`, email, password: "correct horse battery" });
  const user = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (user) created.push(user.accountId);
  return { ...r, email, accountId: user?.accountId };
}

async function main() {
  // Sign-up creates a separate, non-owner workspace and a session.
  const a = await signup("a");
  check("sign-up returns 201 with a session cookie", a.status === 201 && a.cookie.startsWith("dist_session="), String(a.status));
  const aAccount = a.accountId ? (await db.select().from(accounts).where(eq(accounts.id, a.accountId)))[0] : undefined;
  check("new workspace is not the owner workspace", aAccount?.isOwner === false);

  const dup = await post("/api/auth/signup", { workspace: "dup", email: a.email.toUpperCase(), password: "correct horse battery" });
  check("duplicate email (any case) is refused with 409", dup.status === 409, String(dup.status));

  const weak = await post("/api/auth/signup", { workspace: "weak", email: `qa.weak.${Date.now()}@example.com`, password: "short" });
  check("password under 10 characters is refused", weak.status === 400, String(weak.status));

  // Sign-in checks the user's own hash.
  const good = await post("/api/auth/login", { email: a.email, password: "correct horse battery" });
  check("sign-in with own password succeeds", good.status === 200);
  const bad = await post("/api/auth/login", { email: a.email, password: "wrong password here" });
  check("sign-in with wrong password fails", bad.status === 401);

  // The operator's bootstrap password grants nothing once an owner exists.
  const bootstrap = process.env.APP_PASSWORD;
  if (bootstrap) {
    const backdoor = await post("/api/auth/login", { email: `qa.intruder.${Date.now()}@example.com`, password: bootstrap });
    check("APP_PASSWORD cannot mint a new user once an owner exists", backdoor.status === 401, String(backdoor.status));
    const intruderRows = await db.select().from(users).where(eq(users.email, `qa.intruder@example.com`));
    check("no intruder user row was created", intruderRows.length === 0);
  }

  // Workspaces cannot see each other.
  const b = await signup("b");
  const ownerProduct = (await db.select({ id: products.id }).from(products).innerJoin(accounts, eq(accounts.id, products.accountId)).where(eq(accounts.isOwner, true)).limit(1))[0];
  if (ownerProduct) {
    // With a loading skeleton, Next streams the not-found page with status 200
    // and a noindex tag, so assert on what is served, not the status code.
    const peek = await get(`/products/${ownerProduct.id}`, b.cookie);
    const owner = (await db.select({ product: products.product }).from(products).where(eq(products.id, ownerProduct.id)))[0];
    const ownerName = (owner?.product as { tagline?: string } | undefined)?.tagline ?? "__none__";
    check("another workspace's product page serves the not-found page", peek.text.includes("This page did not get distributed") && peek.text.includes("noindex"), String(peek.status));
    check("and leaks none of that product's data", !peek.text.includes(ownerName));
    const api = await fetch(`${BASE}/api/products/${ownerProduct.id}`, { headers: { cookie: b.cookie } });
    check("another workspace's product API is refused", api.status === 404 || api.status === 403, String(api.status));
  }
  const list = await fetch(`${BASE}/api/products`, { headers: { cookie: b.cookie } }).then((r) => r.json() as Promise<{ products?: unknown[] }>);
  check("a fresh workspace lists no products", Array.isArray(list.products) && list.products.length === 0, String(list.products?.length));

  // A signed-up workspace never inherits the operator's Postiz key.
  const conns = await fetch(`${BASE}/api/postiz/connections`, { headers: { cookie: b.cookie } }).then((r) => r.json() as Promise<{ connections?: unknown[] }>);
  check("new workspace has no Postiz connection by default", Array.isArray(conns.connections) && conns.connections.length === 0, String(conns.connections?.length));
  const connect = await fetch(`${BASE}/api/postiz/connect/tiktok`, { method: "POST", headers: { cookie: b.cookie } });
  check("connecting a channel without a Postiz key is refused", connect.status === 404, String(connect.status));

  // Workspace budget: two products cannot exceed the workspace cap together.
  if (b.accountId) {
    await db.insert(limits).values({ id: newId(), scope: "account", scopeId: b.accountId, key: "usd_month", value: 0.05 });
    const ids = [newId(), newId()];
    for (const [i, id] of ids.entries()) {
      await db.insert(products).values({ id, accountId: b.accountId, slug: `qa-budget-${i}-${Date.now()}`, product: { name: `QA ${i}` } as never, brand: {} as never, sources: {} as never, publishing: {} as never, contentPreferences: {} as never });
    }
    // An uncertain provider call keeps its full reservation, so it counts.
    await productBudget(db, ids[0]!, newId()).run(0.04, async () => { throw new Error("transport dropped"); }).catch(() => undefined);
    const inside = await productBudget(db, ids[1]!, newId()).run(0.005, async () => "ran").catch((e) => e);
    check("second product can still spend what is left of the workspace cap", inside === "ran", inside instanceof Error ? inside.message.slice(0, 80) : "");
    const over = await productBudget(db, ids[1]!, newId()).run(0.04, async () => "ran").catch((e) => e);
    check("second product is stopped by the shared workspace cap", over instanceof BudgetExceededError, over instanceof Error ? over.message.slice(0, 90) : String(over));
    await db.delete(products).where(inArray(products.id, ids));
  }
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    if (created.length) await db.delete(accounts).where(inArray(accounts.id, created));
    if (created.length) await db.delete(limits).where(inArray(limits.scopeId, created));
    await closeDb();
    console.log(failures === 0 ? "\nall workspace checks passed" : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
