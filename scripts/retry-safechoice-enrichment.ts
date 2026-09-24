import './_env';
import assert from 'node:assert/strict';
import {getDb,closeDb,products,users,jobs,eq} from '@distribution/db';
const db=getDb();
try {
 const job=(await db.select().from(jobs).where(eq(jobs.id,process.argv[2] ?? '3ad4a2fd-2886-4e10-ae26-f1e9cc119e6b')))[0]!;
 assert.equal(job.status,'failed');
 if(job.result?.retryJobId){console.log(JSON.stringify({existingRetryJobId:job.result.retryJobId}));}
 else {
 const product=(await db.select().from(products).where(eq(products.id,job.productId!)))[0]!;
 const user=(await db.select().from(users).where(eq(users.accountId,product.accountId)))[0]!;
 const base='http://127.0.0.1:3001';
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password:process.env.APP_PASSWORD})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
 const response=await fetch(base+'/api/jobs/'+job.id,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'retry'})});
 assert.equal(response.status,202);console.log(await response.text());
 }
}finally{await closeDb();}
