import './_env';
import {getDb,closeDb} from '@distribution/db';
import {JobQueue} from '@distribution/jobs';
// Operator recovery after confirming the previous worker and its entire media
// process tree are gone. Queue failure retains normal retry limits/accounting.
const q=await JobQueue.start(getDb());
try {
 const id='9f1c9bd8-2f37-427b-a341-b90536ce767b';
 const job=await q.boss.getJobById('media',id);
 if(job?.state==='active') console.log(await q.boss.fail('media',id,{message:'Worker process 53717 terminated; no surviving media processes. Recovering through queue retry.'}));
 console.log(await q.reclaimStaleJobs());
}finally{await q.stop();await closeDb();}
