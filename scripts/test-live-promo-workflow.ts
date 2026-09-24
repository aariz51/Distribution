/** Real authenticated promo acceptance; pass project ID to resume without creating another run. */
import "./_env";
import { closeDb, eq, getDb, jobs, products, projects, users, assets } from "@distribution/db";
import { writeFile, stat } from "node:fs/promises";
import { getStorage } from "@distribution/storage";
import { bin, probeMedia, run } from "@distribution/media";

async function main() {
  const db = getDb();
  const origin = "http://127.0.0.1:3001";
  try {
    const product = (await db.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
    const user = (await db.select().from(users).where(eq(users.accountId, product.accountId)))[0]!;
    if (!user || !process.env.APP_PASSWORD) throw new Error("Normal account credentials required");
    const login = await fetch(`${origin}/api/auth/login`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({email:user.email,password:process.env.APP_PASSWORD})});
    if (!login.ok) throw new Error(`Login ${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing session");
    let projectId = process.argv[2];
    if (!projectId) {
      const response = await fetch(`${origin}/api/products/${product.id}/promo`, {method:"POST", headers:{cookie,"content-type":"application/json"}, body:JSON.stringify({durationSec:18})});
      if (response.status !== 202) throw new Error(`Promo submission ${response.status}: ${await response.text()}`);
      projectId = (await response.json() as {projectId:string}).projectId;
    }
    if (!projectId) throw new Error("Missing project ID");
    console.log(`Real SafeChoice project: ${projectId}`);
    const evidence = new URL("../storage/tmp/live-promo-workflow.json", import.meta.url);
    await writeFile(evidence, JSON.stringify({projectId,status:"submitted"},null,2));
    const deadline=Date.now()+25*60_000;
    let last="";
    for (;;) {
      const p=(await db.select().from(projects).where(eq(projects.id,projectId)))[0]!;
      if (p.productId !== product.id) throw new Error("Wrong product");
      const rows=await db.select().from(jobs).where(eq(jobs.projectId,projectId));
      const line=rows.map(j=>`${j.type}:${j.status}:${j.progressPct}`).join(" ");
      if (line!==last) {console.log(line);last=line;}
      if (rows.some(j=>j.status==="failed")) throw new Error(JSON.stringify(rows.filter(j=>j.status==="failed").map(j=>j.error)));
      if (p.status==="completed" && rows.every(j=>j.status==="completed")) break;
      if(Date.now()>deadline) throw new Error("Timed out; resume with project ID");
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
    const outputs=await db.select().from(assets).where(eq(assets.projectId,projectId));
    const videos=outputs.filter(a=>a.mimeType==="video/mp4");
    const covers=outputs.filter(a=>a.mimeType==="image/png");
    if(videos.length!==6 || covers.length!==4) throw new Error(`Expected 6 videos/4 covers: ${videos.length}/${covers.length}`);
    for(const asset of [...videos,...covers]) {
      const file=await getStorage().localPathFor(asset.storageKey);
      const probe=await probeMedia(file);
      if(probe.width!==asset.width || probe.height!==asset.height) throw new Error(`Dimensions mismatch: ${asset.type}`);
      if(asset.mimeType==="video/mp4" && (!probe.hasAudio || !probe.hasVideo || Math.abs(probe.durationSec-asset.durationSec!)>0.15)) throw new Error(`Invalid media: ${asset.type}`);
      await run(bin("ffmpeg"),["-v","error","-xerror","-i",file,"-f","null","-"],{timeoutMs:120_000});
      const url=`${origin}/api/files/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}`;
      const head=await fetch(url,{method:"HEAD",headers:{cookie}});
      const actualSize=(await stat(file)).size;
      if(head.status!==200 || Number(head.headers.get("content-length"))!==actualSize || (asset.sizeBytes!==null && asset.sizeBytes!==actualSize)) throw new Error(`Delivery failed: ${asset.type}`);
      console.log(`Verified ${asset.type}: ${probe.width}x${probe.height}`);
    }
    await writeFile(evidence,JSON.stringify({projectId,status:"verified",videos:videos.map(a=>({id:a.id,key:a.storageKey})),covers:covers.map(a=>({id:a.id,key:a.storageKey})),checkedAt:new Date().toISOString()},null,2));
    console.log("PASS: authenticated real promo queue, six fully decoded exports, four decoded covers and authenticated delivery");
  } finally {await closeDb();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
