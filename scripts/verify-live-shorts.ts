/** Read-only end-to-end verification of an existing real main SafeChoice run. */
import "./_env";
import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { assets, assetCopy, closeDb, eq, getDb, inArray, jobs, products, projects, users } from "@distribution/db";
import { getStorage } from "@distribution/storage";
import { bin, probeMedia, run } from "@distribution/media";
import { requireScreenedOutput, requireScreenedSource } from "../packages/pipelines/src/shorts/screening";
const projectId=process.argv[2];
if(!projectId)throw new Error('Existing project ID required');
const db=getDb();
try {
 const project=(await db.select().from(projects).where(eq(projects.id,projectId)))[0]!;
 assert.equal(project.productId,'6cc41ef3-7761-4520-b843-361ce1b8bca7');assert.equal(project.status,'completed');
 const work=await db.select().from(jobs).where(eq(jobs.projectId,projectId));assert(work.every(j=>j.status==='completed'));
 const product=(await db.select().from(products).where(eq(products.id,project.productId)))[0]!;
 const user=(await db.select().from(users).where(eq(users.accountId,product.accountId)))[0]!;
 const origin='http://127.0.0.1:3001';
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password:process.env.APP_PASSWORD})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
 const all=await db.select().from(assets).where(eq(assets.projectId,projectId));
 const clips=all.filter(a=>a.type==='clip'), enriched=all.filter(a=>a.type==='clip_enriched'), covers=all.filter(a=>a.type==='thumbnail');
 assert.equal(clips.length,2);assert.equal(enriched.length,2);assert.equal(covers.length,6);
 const signal=AbortSignal.timeout(600000);
 await requireScreenedSource(db,project.sourceId!,product.id,signal);
 const copies=await db.select().from(assetCopy).where(inArray(assetCopy.assetId,clips.map(a=>a.id)));
 for(const clip of clips){
  assert(clip.thumbnailAssetId && covers.some(c=>c.id===clip.thumbnailAssetId));
  assert(copies.some(c=>c.assetId===clip.id && [c.caption,c.description].join(' ').includes('GyjyUeSUe_E')),'Source attribution missing from saved copy');
 }
 for(const asset of [...clips,...enriched,...covers]){
  const file=await getStorage().localPathFor(asset.storageKey), meta=await probeMedia(file);
  assert.equal(meta.width,asset.width);assert.equal(meta.height,asset.height);
  if(asset.type!=='thumbnail'){
   assert(meta.hasVideo && meta.hasAudio);assert(Math.abs(meta.durationSec-asset.durationSec!)<0.15);
   await requireScreenedOutput(asset.storageKey,asset.metadata.outputScreening,signal);
  }
  if(asset.type==='clip_enriched'){
   assert.equal(asset.metadata.voice,'female');assert.deepEqual(asset.metadata.steps,['outro']);
   assert(asset.thumbnailAssetId && covers.some(c=>c.id===asset.thumbnailAssetId));
  }
  await run(bin('ffmpeg'),['-v','error','-xerror','-i',file,'-f','null','-'],{signal,timeoutMs:120000});
  const size=(await stat(file)).size;
  const url=origin+'/api/files/'+asset.storageKey.split('/').map(encodeURIComponent).join('/');
  const head=await fetch(url,{method:'HEAD',headers:{cookie}});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),size);
  const range=await fetch(url,{headers:{cookie,range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,Math.min(size,1024));
  console.log(`Verified ${asset.type} ${asset.id}: ${asset.width}x${asset.height}`);
 }
 await writeFile(new URL(`../storage/tmp/verified-shorts-${projectId}.json`,import.meta.url),JSON.stringify({projectId,checkedAt:new Date().toISOString(),status:'verified',assets:all.map(a=>({id:a.id,type:a.type,key:a.storageKey})),copies:copies.map(c=>({id:c.id,assetId:c.assetId,platform:c.platform}))},null,2));
 console.log('PASS: original and finished screening proofs, two clips/two female-voice branded derivatives/six covers, full decode, attribution and authenticated delivery');
} finally {await closeDb();}
