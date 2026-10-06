// Historical archive workflow: run before migration 019 retires submission and group writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { phaseDatabase, TERM } from './helpers/phase-a.mjs';
import { createHandler } from '../supabase/functions/submission-file/handler.js';
let h;
before(async () => { h=await phaseDatabase(undefined,'018_canvas_mirror.sql'); });
after(async () => h?.db.close());
const submit = async (who='a',item=1) => { const p=await h.begin(who,item); return {p,s:(await h.finish(p,who)).submission}; };

test('before-due deletion returns only SQL paths, cancels pending work, and audits the old row', async () => {
  await h.as('teacher'); await h.rpc('configure_grade_item',1,'file','individual',null,'2099-01-01');
  const {p,s}=await submit(), replacement=await h.begin('a',1), receipt=await h.verify(replacement);
  await h.as('a'); const paths=await h.rpc('delete_submission',s.id);
  assert.deepEqual(paths.sort(),[p.storage_path,replacement.storage_path].sort());
  assert.equal((await h.rpc('class_data')).submissions.length,0);
  await assert.rejects(h.rpc('finish_submission',replacement.id,receipt),/Pending upload not found/);
  await h.as('teacher'); const audit=(await h.rows("select * from audit_log where table_name='submissions' and operation='DELETE' order by id desc"))[0];
  assert.equal(audit.actor_email,'aa1001@columbia.edu'); assert.equal(audit.old_row.id,s.id); assert.equal(audit.old_row.storage_path,p.storage_path); assert.equal(audit.new_row,null);
  await h.as('owner'); assert.equal((await h.rows('select id from pending_uploads where id=$1',[replacement.id])).length,0);
});

test('delete rejects all forbidden roles, preview, peers, and direct table writes without changing the file', async () => {
  const {s}=await submit();
  for (const who of ['teacher','grader','auditor','outside','anon','b']) {
    await h.as(who); await assert.rejects(h.rpc('delete_submission',s.id),/access required|permission denied/i,who);
    await assert.rejects(h.rows('delete from submissions where id=$1',[s.id]),/permission denied/,who);
  }
  await h.as('teacher'); await h.rpc('set_student_preview','aa1001');
  await assert.rejects(h.rpc('delete_submission',s.id),/read-only/); await h.rpc('set_student_preview',null);
  await h.as('a'); assert.equal((await h.rpc('class_data')).submissions[0].id,s.id);
  await h.rpc('delete_submission',s.id);
});

test('deadline and zero-score locks reject deletion; deadline equality is forbidden', async () => {
  const {s}=await submit();
  await h.as('teacher'); await h.rpc('configure_grade_item',1,'file','individual',null,'2020-01-01');
  await h.as('a'); await assert.rejects(h.rpc('delete_submission',s.id),/deadline/);
  await h.as('owner'); await h.rows('update grade_items set due_at=clock_timestamp() where id=1');
  await h.as('a'); await assert.rejects(h.rpc('delete_submission',s.id),/deadline/);
  await h.as('teacher'); await h.rpc('configure_grade_item',1,'file','individual',null,null);
  await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:0}]));
  await h.as('a'); await assert.rejects(h.rpc('delete_submission',s.id),/Graded, locked/);
  await h.as('teacher'); await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:null}]));
  await h.as('a'); await h.rpc('delete_submission',s.id);
});

test('unset due time permits deleting both current and retained on-time objects; a clean resubmission still works', async () => {
  const first=await submit();
  await h.as('teacher'); await h.rpc('configure_grade_item',1,'file','individual',null,'2020-01-01');
  const late=await submit(); assert.equal(late.s.on_time_path,first.p.storage_path);
  await h.as('teacher'); await h.rpc('configure_grade_item',1,'file','individual',null,null);
  await h.as('a'); assert.deepEqual((await h.rpc('delete_submission',late.s.id)).sort(),[first.p.storage_path,late.p.storage_path].sort());
  const fresh=await submit(); assert.notEqual(fresh.s.id,late.s.id); assert.equal(fresh.s.on_time_path,null);
  await h.rpc('delete_submission',fresh.s.id);
});

for (const kind of ['file','link']) test(`only the current group ${kind} uploader can delete; teammates can replace and membership stays frozen`, async () => {
  const item=kind==='file'?2:6;
  await h.as('teacher'); const set=await h.rpc('create_group_set',`Uploader ${kind}`,2,4,null), groups=(await h.rpc('class_data')).groups.filter(g=>g.set_id===set);
  await h.rpc('configure_grade_item',item,kind,'group',set,'2099-01-01');
  for (const uni of ['aa1001','bb1002']) await h.rpc('choose_group',set,groups[0].id,uni);
  await h.rpc('choose_group',set,groups[1].id,'cc1003');
  const save=async who=>{await h.as(who);return kind==='file'?(await submit(who,item)).s:(await h.rpc('submit_link',item,`https://example.test/${who}`)).submission;};
  const original=await save('a');
  let snapshot=(await h.rpc('class_data')).submissions.find(s=>s.id===original.id);
  assert.equal(snapshot.is_uploader,true);assert.equal(snapshot.submitted_by,undefined);assert.equal(snapshot.member_unis,undefined);
  const denial='Only the member who uploaded this file can delete it. You can replace it.';
  await h.as('b');assert.equal((await h.rpc('class_data')).submissions.find(s=>s.id===original.id).is_uploader,false);
  await assert.rejects(h.rpc('delete_submission',original.id),{message:denial});
  for (const who of ['a','b']) {
    await h.as(who);
    await assert.rejects(h.rpc('choose_group',set,null),/submitted work cannot be joined or left/);
    await assert.rejects(h.rpc('choose_group',set,groups[1].id),/submitted work cannot be joined or left/);
  }
  await h.as('c');await assert.rejects(h.rpc('delete_submission',original.id),/access required/);
  await assert.rejects(h.rpc('choose_group',set,groups[0].id),/submitted work cannot be joined or left/);
  const replacement=await save('b');assert.equal(replacement.id,original.id);
  snapshot=(await h.rpc('class_data')).submissions.find(s=>s.id===original.id);assert.equal(snapshot.is_uploader,true);
  await h.as('a');assert.equal((await h.rpc('class_data')).submissions.find(s=>s.id===original.id).is_uploader,false);
  await assert.rejects(h.rpc('delete_submission',original.id),{message:denial});
  // Uploader status cannot bypass the current-membership check.
  await h.as('teacher');await h.rpc('choose_group',set,groups[1].id,'bb1002');
  await h.as('b');await assert.rejects(h.rpc('delete_submission',original.id),/access required/);
  await h.as('teacher');await h.rpc('choose_group',set,groups[0].id,'bb1002');
  await h.as('b');assert.deepEqual(await h.rpc('delete_submission',original.id),kind==='file'?[replacement.storage_path]:[]);
  await h.rpc('choose_group',set,groups[1].id);
  assert.equal((await h.rpc('class_data')).submissions.some(s=>s.id===original.id),false);
});

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
