import "./_env";
import { getDb, users, closeDb } from "@distribution/db";
import { writeFile } from "node:fs/promises";
const user=(await getDb().select().from(users).limit(1))[0];
if(!user || !process.env.APP_PASSWORD) throw new Error("Normal login unavailable");
await writeFile('/Users/aarizazizrasheed/prompt md/.playwright-mcp/distribution-login-private.js',`async page => { await page.locator('input[type="email"]').fill(${JSON.stringify(user.email)}); await page.locator('input[type="password"]').fill(${JSON.stringify(process.env.APP_PASSWORD)}); await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.waitForURL('**/products'); return 'Normal sign-in succeeded'; }`,{mode:0o600});
await closeDb();
