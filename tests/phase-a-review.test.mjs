// Historical archive workflow: run before migration 019 retires submission and group writes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { phaseDatabase, TERM, uid } from './helpers/phase-a.mjs';
let h;
before(async()=>{h=await phaseDatabase(undefined,'018_canvas_mirror.sql');});after(async()=>h?.db.close());
beforeEach(async()=>{
  await h.as('owner');await h.db.exec("delete from private.student_previews; delete from pending_uploads; delete from submissions; delete from grades; delete from attendance; delete from group_memberships; delete from class_groups; update grade_items set group_set_id=null,due_at=null,released=false; delete from group_sets; delete from storage.objects");
});
async function groups(item=2) {
  await h.as('teacher');const set=await h.rpc('create_group_set','Review groups',2,4,null);
  const list=(await h.rpc('class_data')).groups.filter(g=>g.set_id===set);
  await h.rpc('configure_grade_item',item,'file','group',set,null);
  await h.rpc('choose_group',set,list[0].id,'aa1001');await h.rpc('choose_group',set,list[1].id,'bb1002');
  return {set,list};
}
test('review 1: submitted source and destination groups block student changes but allow instructor moves',async()=>{
  const {set,list}=await groups();await h.finish(await h.begin('a',2));
  await h.as('a');await assert.rejects(h.rpc('choose_group',set,null),/submitted work/);
  await assert.rejects(h.rpc('choose_group',set,list[1].id),/submitted work/);
  await h.as('b');await assert.rejects(h.rpc('choose_group',set,list[0].id),/submitted work/);
  await h.as('c');await assert.rejects(h.rpc('choose_group',set,list[0].id),/submitted work/);
  await h.as('teacher');await h.rpc('choose_group',set,list[1].id,'aa1001');await h.rpc('choose_group',set,list[0].id,'bb1002');
  const members=(await h.rpc('class_data')).members;assert.equal(members.find(m=>m.uni==='aa1001').group_id,list[1].id);assert.equal(members.find(m=>m.uni==='bb1002').group_id,list[0].id);
});
test('review 2: stored object creation time closes the on-time-begin loophole with a five-minute grace',async()=>{
  for(const [objectTime,late] of [['09:04:00',false],['09:05:00',false],['09:20:00',true]]) {
    await h.as('owner');await h.db.exec('delete from pending_uploads; delete from submissions; delete from storage.objects');
    await h.rows("update grade_items set due_at='2020-01-01T09:00Z' where id=1");
    const p=await h.begin();assert.ok(new Date(p.expires_at)-new Date(p.started_at)<=900001);
    await h.as('owner');
    // Keep expiry live while isolating historical start/object timestamps from the test clock.
    await h.rows("update pending_uploads set started_at='2020-01-01T08:59Z' where id=$1",[p.id]);
    await h.rows("insert into storage.objects(bucket_id,name,created_at) values('submissions',$1,$2)",[p.storage_path,`2020-01-01T${objectTime}Z`]);
    const s=(await h.finish(p)).submission;assert.equal(s.late,late);assert.equal(new Date(s.object_created_at).toISOString(),`2020-01-01T${objectTime}.000Z`);
  }
});
test('review 2/12: confirm requires a real object and an explicit matching term; expired pending cannot finish',async()=>{
  const p=await h.begin();await h.as('service');
  await assert.rejects(h.rpc('confirm_submission_upload',TERM,p.id,10,'application/pdf'),/object not found/);
  await assert.rejects(h.rpc('confirm_submission_upload','other-term',p.id,10,'application/pdf'),/not found/);
  assert.deepEqual(await h.rpc('reject_submission_upload','other-term',p.id),[]);
  const receipt=await h.verify(p);await h.as('owner');await h.rows("update pending_uploads set expires_at=now()-interval '1 second' where id=$1",[p.id]);
  await h.as('a');await assert.rejects(h.rpc('finish_submission',p.id,receipt),/expired/);
  await h.as('service');assert.deepEqual(await h.rpc('submission_sweep_candidates','other-term'),[]);
  assert.deepEqual(await h.rpc('submission_sweep_candidates',TERM),[p.storage_path]);
});
test('review 3: zero before first submission locks individual and current group owners',async()=>{
  await h.as('grader');await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":0}]');
  await assert.rejects(h.begin(),/Graded, locked/);
  assert.equal((await h.rpc('class_data')).submission_items.find(i=>i.id===1).locked,true);
  const {set,list}=await groups();await h.as('teacher');await h.rpc('choose_group',set,list[0].id,'cc1003');
  const pending=await h.begin('a',2),receipt=await h.verify(pending);
  await h.as('grader');await h.rpc('save_grades','[{"uni":"cc1003","item_id":2,"score":0}]');
  await h.as('a');await assert.rejects(h.rpc('finish_submission',pending.id,receipt),/Graded, locked/);
  await assert.rejects(h.begin('a',2),/Graded, locked/);
  await h.as('grader');await h.rpc('save_grades','[{"uni":"cc1003","item_id":2,"score":null}]');
  assert.ok(await h.begin('a',2));
});
test('review 3: the final insertion also records an existing grade lock as a defensive invariant',async()=>{
  await h.as('grader');await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":0}]');
  await h.as('a');await h.db.query('reset role');await h.rows("select private.store_submission($1,1,'aa1001',null,'trusted-test.pdf',null,'work.pdf',10,now(),now())",[TERM]);
  assert.ok((await h.rows('select graded_at from submissions'))[0].graded_at);
});
test('review 4/5: student DTOs expose lock state and only necessary submission item metadata',async()=>{
  const p=await h.begin(),saved=(await h.finish(p)).submission;assert.equal(saved.locked,false);assert.equal('graded_at' in saved,false);
  await h.as('grader');await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":8}]');
  assert.ok((await h.rpc('class_data')).submissions[0].graded_at);
  for(const who of ['a','teacher']) {
    await h.as(who);if(who==='teacher')await h.rpc('set_student_preview','aa1001');
    await assert.rejects(h.rows('select graded_at from submissions'),/permission denied/);
    const d=await h.rpc('class_data');assert.equal(d.submissions[0].locked,true);assert.equal('graded_at' in d.submissions[0],false);
    assert.ok(d.submission_items.every(i=>i.kind!=='none'));assert.equal(d.submission_items.length,9);
    for(const i of d.submission_items)assert.deepEqual(Object.keys(i).sort(),['id','term_id','code','title','kind','mode','group_set_id','due_at','locked'].sort());
    assert.deepEqual(d.grades,[]);assert.ok(!d.submission_items.some(i=>i.code.startsWith('Q') || i.code==='PA' || i.code==='O4'));
  }
});
test('review 7: instructor switches preview A to B directly while writes and closed-term preview stay blocked',async()=>{
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  assert.equal((await h.rpc('set_student_preview','bb1002')).view_as.uni,'bb1002');
  await assert.rejects(h.rpc('save_grades','[]'),/read-only/);
  await h.rpc('set_student_preview',null);
  await h.as('owner');await h.db.exec("insert into terms(id,title,status) values('closed-review','Closed','closed');insert into roster(term_id,uni,name) values('closed-review','aa1001','Alice')");
  await h.as('teacher');await assert.rejects(h.rpc('set_student_preview','aa1001','closed-review'),/Student not found/);
  await h.as('owner');await h.rows("update terms set status='archived-readable' where id='closed-review'");
  await h.as('teacher');assert.equal((await h.rpc('set_student_preview','aa1001','closed-review')).read_only,true);
  await assert.rejects(h.rpc('begin_submission',1,'work.pdf',10,'application/pdf'),/read-only/);
  assert.equal((await h.rpc('set_student_preview','bb1002')).term_id,TERM);await h.rpc('set_student_preview',null);
  await h.as('a');await assert.rejects(h.rpc('set_student_preview','bb1002'),/Instructor/);
});
test('review 9: repeated grades and unrelated student scores do not emit submission audit updates',async()=>{
  await h.finish(await h.begin());await h.finish(await h.begin('b'),'b');
  await h.as('teacher');const count=async()=>Number((await h.rows("select count(*) n from audit_log where table_name='submissions' and operation='UPDATE'"))[0].n);
  const start=await count();await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":8}]');assert.equal(await count(),start+1);
  const stamp=(await h.rpc('class_data')).submissions.find(s=>s.owner_uni==='aa1001').graded_at;
  await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":9,"comment":"New feedback"}]');assert.equal(await count(),start+1);
  assert.equal((await h.rpc('class_data')).submissions.find(s=>s.owner_uni==='aa1001').graded_at,stamp);
  await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":null}]');assert.equal(await count(),start+2);
  await h.rpc('save_grades','[{"uni":"aa1001","item_id":1,"score":null}]');assert.equal(await count(),start+2);
});
test('review 10: removing an Auth user cascades to pending uploads',async()=>{
  const p=await h.begin('d');await h.as('owner');await h.rows('delete from auth.identities where user_id=$1',[uid('d')]);await h.rows('delete from auth.users where id=$1',[uid('d')]);
  assert.deepEqual(await h.rows('select id from pending_uploads where id=$1',[p.id]),[]);
});
test('review 11: the ignored private seed imports idempotently after migrations 006–008',async()=>{
  const path=new URL('../supabase/private/seed.sql',import.meta.url);
  // Public checkouts have no private seed. Synthetic tests cover the same columns and key.
  const sql=existsSync(path)?readFileSync(path,'utf8'):"insert into assignments(term_id,id,title,due,points,description,deliverable,grading,auditor_visible) values('spring-2027',1,'Demo','Week 1',10,'Synthetic','Demo','Demo',false) on conflict(term_id,id) do nothing";
  await h.as('owner');
  try {await h.db.exec(sql);await h.db.exec(sql);} catch(e) {assert.fail(`Private seed failed, SQLSTATE ${e.code}. Contents omitted.`);}
  assert.ok(Number((await h.rows('select count(*) n from assignments'))[0].n)>0);
  await h.rows("update assignments set title='Instructor edit' where term_id=$1 and id=1",[TERM]);
  try {await h.db.exec(sql);} catch(e) {assert.fail(`Private seed failed, SQLSTATE ${e.code}. Contents omitted.`);}
  assert.equal((await h.rows('select title from assignments where term_id=$1 and id=1',[TERM]))[0].title,'Instructor edit');
});
