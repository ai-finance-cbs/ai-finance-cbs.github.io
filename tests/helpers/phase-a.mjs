import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { bootstrapSQL, migrationFiles, seedGoogleIdentity } from './database.mjs';
export const TERM='spring-2027';
export const people={teacher:'oh@gsb.columbia.edu',grader:'grader@columbia.edu',auditor:'auditor@columbia.edu',a:'aa1001@columbia.edu',b:'bb1002@columbia.edu',c:'cc1003@columbia.edu',d:'dd1004@columbia.edu',outside:'zz9999@columbia.edu'};
export const uid=who=>`20000000-0000-0000-0000-${String(Object.keys(people).indexOf(who)+1).padStart(12,'0')}`;
export async function phaseDatabase(db=new PGlite(), through=null) {
  const exec=sql=>db.exec ? db.exec(sql) : db.query(sql);
  await exec(bootstrapSQL);
  for(const file of migrationFiles) {
    await exec(readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
    if(file===through)break;
  }
  for(const [who,email] of Object.entries(people)) {
    await db.query('insert into auth.users values($1,$2,now(),\'{"provider":"google"}\')',[uid(who),email]);
    await seedGoogleIdentity(db,uid(who),email);
  }
  await exec("delete from private.test_accounts; insert into roster(uni,name) values('aa1001','Alice'),('bb1002','Bob'),('cc1003','Carol'),('dd1004','Dan'); insert into allowlist values('grader@columbia.edu','grader'),('auditor@columbia.edu','auditor')");
  const as=async who=>{
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(people[who]?{sub:uid(who),email:people[who]}:{})]);
    if(who!=='owner') await db.query(`set role ${who==='service'?'service_role':who==='anon'?'anon':'authenticated'}`);
  };
  const rpc=async(name,...args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
  const rows=async(sql,params=[])=>(await db.query(sql,params)).rows;
  const begin=async(who='a',item=1)=>{await as(who);return rpc('begin_submission',item,'work.pdf',10,'application/pdf');};
  const verify=async p=>{
    // Emulate a completed Storage upload. Explicit test objects retain their chosen creation time.
    await as('owner');
    await rows("insert into storage.objects(bucket_id,name,created_at) select 'submissions',storage_path,started_at from pending_uploads where term_id=$1 and id=$2 and not exists(select 1 from storage.objects where bucket_id='submissions' and name=$3)",[p.term_id,p.id,p.storage_path]);
    await as('service');return rpc('confirm_submission_upload',p.term_id,p.id,p.file_size,p.mime_type);
  };
  const finish=async(p,who='a')=>{const receipt=await verify(p);await as(who);return rpc('finish_submission',p.id,receipt);};
  return {db,as,rpc,rows,begin,verify,finish};
}
