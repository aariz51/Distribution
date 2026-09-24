import "dotenv/config";
import { assets, closeDb, eq, getDb, products, users } from "@distribution/db";

async function main() {
  const origin = "http://127.0.0.1:3001";
  const db = getDb();
  try {
    const product = (await db.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
    const user = (await db.select().from(users).where(eq(users.accountId, product.accountId)))[0]!;
    if (!user || !process.env.APP_PASSWORD) throw new Error("Existing local account and password required");
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    if (!login.ok) throw new Error(`Normal login failed: ${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing session cookie");
    for (const route of [`/products/${product.id}/library`, `/products/${product.id}/jobs`, `/api/products/${product.id}/assets/library`, "/api/health"]) {
      const result = await fetch(`${origin}${route}`, { headers: { cookie }, redirect: "manual" });
      if (!result.ok) throw new Error(`${route}: ${result.status}`);
      const text = await result.text();
      if (!text.length) throw new Error(`Empty ${route}`);
      if (route === "/api/health") {
        const health = JSON.parse(text);
        if (!health.ok || !health.workers.some((w: { queues: string[] }) => w.queues.includes("render"))) throw new Error("No live rendering worker");
      }
    }
    const media = (await db.select().from(assets).where(eq(assets.productId, product.id))).find(a => a.projectId === "20cfa718-cec9-42b3-8ff1-b80565352551" && a.mimeType === "video/mp4" && a.sizeBytes && a.type !== "source_original");
    if (!media) throw new Error("SafeChoice generated video required");
    const url = `${origin}/api/files/${media.storageKey.split("/").map(encodeURIComponent).join("/")}`;
    const denied = await fetch(url); await denied.body?.cancel();
    if (denied.status !== 401) throw new Error(`Unauthenticated file access: ${denied.status}`);
    const range = await fetch(url, { headers: { cookie, range: "bytes=0-1023" } });
    const rangeBytes = (await range.arrayBuffer()).byteLength;
    if (range.status !== 206 || rangeBytes !== 1024 || !range.headers.get("content-range")?.startsWith("bytes 0-1023/")) throw new Error(`Byte-range playback failed: status=${range.status} bytes=${rangeBytes} content-range=${range.headers.get("content-range")}`);
    const head = await fetch(url, { method: "HEAD", headers: { cookie } });
    if (head.status !== 200 || Number(head.headers.get("content-length")) !== media.sizeBytes) throw new Error("HEAD file size mismatch");
    console.log("PASS: production login, library/jobs SSR, library API, live worker health, unauthorized file denial, video range and HEAD");
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
