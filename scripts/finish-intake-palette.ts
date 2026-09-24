import "./_env";
import { getDb, closeDb, jobs, eq, products, sql } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { brandPalette } from "@distribution/pipelines";
if(!process.env.DATABASE_URL?.includes('distribution_qa_'))throw new Error('QA only');
const db=getDb();
const pending=await db.select().from(jobs).where(sql`${jobs.status} in ('queued','started','progress','retrying')`);
if(pending.some(j=>j.type!=='brand.palette'))throw new Error('Other active QA work; do not consume it');
const queue=await JobQueue.start(db);
try {
 queue.register('brand.palette',brandPalette); await queue.work(['light']);
 let completed=false;
 const end=Date.now()+60000;
 while(Date.now()<end){
  const rows=await db.select().from(jobs).where(eq(jobs.productId,'45c50e11-1a60-4273-a9a0-a220e93d36e5'));
  if(rows.some(j=>j.status==='failed'))throw new Error('Palette failed');
  if(rows.length && rows.every(j=>j.status==='completed')){
   const product=(await db.select().from(products).where(eq(products.id,'45c50e11-1a60-4273-a9a0-a220e93d36e5')))[0]!;
   if(!(product.brand.palette as {source?:string})?.source)throw new Error('No palette saved');
   completed=true; console.log('PASS: real queued palette job sampled uploaded SafeChoice assets and persisted colours');break;
  }
  await new Promise(r=>setTimeout(r,1000));
 }
 if(!completed)throw new Error('Palette did not finish within the test deadline');
} finally {await queue.stop();await closeDb();}
