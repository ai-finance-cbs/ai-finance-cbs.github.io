// Historical archive workflow: run before migration 019 retires submission and group writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { phaseDatabase, TERM } from './helpers/phase-a.mjs';
import { createHandler } from '../supabase/functions/submission-file/handler.js';
let h;
before(async () => { h=await phaseDatabase(undefined,'018_canvas_mirror.sql'); });
after(async () => h?.db.close());
const submit = async (who='a',item=1) => { const p=await h.begin(who,item); return {p,s:(await h.finish(p,who)).submission}; };

test('retired file service deletion preserves current, retained, and unrelated archive objects', async () => {
  const first=await submit();
  await h.as('teacher');await h.rpc('configure_grade_item',1,'file','individual',null,'2020-01-01');
  const next=await submit();
  await h.as('teacher');await h.rpc('configure_grade_item',1,'file','individual',null,null);
  await h.as('owner');await h.rows("insert into storage.objects(bucket_id,name) values('submissions','victim.pdf')");
  const caller={auth:{getUser:async()=>({data:{user:{id:'caller'}}})},rpc:async(name,args={})=>{
    await h.as('a');try{return {data:await h.rpc(name,...Object.values(args))};}catch(error){return {error};}
  }};
  const service={storage:{from:bucket=>({remove:async paths=>{
    assert.equal(bucket,'submissions');assert.deepEqual(paths.sort(),[first.p.storage_path,next.p.storage_path].sort());
    await h.as('owner');await h.rows('delete from storage.objects where bucket_id=$1 and name=any($2::text[])',[bucket,paths]);return {};
  }})}};
  const handler=createHandler((_url,key)=>key==='service'?service:caller,name=>({SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]);
  const response=await handler(new Request('https://function.example/submission-file',{method:'POST',headers:{authorization:'Bearer local',origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify({action:'delete',id:next.s.id,paths:['victim.pdf']})}));
  assert.equal(response.status,410);assert.match((await response.json()).error,/read-only archives/);
  await h.as('owner');assert.equal((await h.rows('select id from submissions where id=$1',[next.s.id])).length,1);
  assert.equal((await h.rows('select name from storage.objects where name=any($1::text[])',[[first.p.storage_path,next.p.storage_path]])).length,2);
  assert.equal((await h.rows("select name from storage.objects where name='victim.pdf'")).length,1);
});

test('archived work cannot be deleted after opening the next term', async () => {
  const {s}=await submit(); await h.as('teacher'); await h.rpc('open_term','Spring 2028');
  await h.as('a'); await assert.rejects(h.rpc('delete_submission',s.id),/Archived term is read-only/);
  await h.as('teacher'); assert.equal((await h.rpc('class_data',TERM)).submissions[0].id,s.id);
});
