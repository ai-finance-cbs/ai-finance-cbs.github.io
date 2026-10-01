import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
let h;
before(async()=>{h=await phaseDatabase();});after(async()=>h?.db.close());
async function clear(){await h.as('owner');await h.db.exec('delete from pending_uploads; delete from submissions; delete from grades; delete from attendance; delete from group_memberships; delete from class_groups; update grade_items set group_set_id=null,due_at=null,released=false; delete from group_sets');}
async function group(item=2){await h.as('teacher');const set=await h.rpc('create_group_set','Team',2,4,null);const groups=(await h.rpc('class_data')).groups.filter(g=>g.set_id===set);await h.rpc('configure_grade_item',item,item===6?'link':'file','group',set,null);for(const who of ['a','b','c','d']){await h.as(who);await h.rpc('choose_group',set,groups[0].id);}return {set,groups};}
async function due(item,date){await h.as('owner');await h.rows('update grade_items set due_at=$1 where id=$2',[date,item]);}
async function startAt(p,date){await h.as('owner');await h.rows('update pending_uploads set started_at=$1 where id=$2',[date,p.id]);}

test('seeded item modes and kinds match the locked course design',async()=>{
  await h.as('teacher');const d=await h.rpc('class_data');
  for(const i of d.items){assert.equal(i.mode,['M2','M3','M5','FP'].includes(i.code)?'group':'individual');assert.equal(i.kind,i.code==='FP'?'link':['M1','M2','M3','M4','M5','O1','O2','O3'].includes(i.code)?'file':'none');assert.equal('instructions' in i,false);}
});
test('late follows server begin time, including an on-time upload that finishes after the deadline',async()=>{
  await clear();await due(1,'2020-01-01T14:00:00Z');let p=await h.begin();await startAt(p,'2020-01-01T13:59:00Z');
  let s=(await h.finish(p)).submission;assert.equal(s.late,false);assert.equal(new Date(s.started_at).toISOString(),'2020-01-01T13:59:00.000Z');
  const timely=s.storage_path;
  p=await h.begin();await startAt(p,'2020-01-01T14:02:00Z');s=(await h.finish(p)).submission;assert.equal(s.late,true);assert.equal(s.on_time_path,timely);
  p=await h.begin();await startAt(p,'2020-01-01T14:20:00Z');const result=await h.finish(p);assert.equal(result.submission.late,true);assert.equal(new Date(result.submission.started_at).toISOString(),'2020-01-01T14:20:00.000Z');assert.equal(result.submission.on_time_path,timely);assert.deepEqual(result.replaced_paths,[s.storage_path]);
});
test('before-deadline replacement removes the old object and audits the old path',async()=>{
  await clear();await due(1,'2100-01-01');const first=await h.finish(await h.begin());const second=await h.finish(await h.begin());
  assert.deepEqual(second.replaced_paths,[first.submission.storage_path]);assert.equal(second.submission.on_time_path,null);
  await h.as('teacher');const logs=await h.rows("select old_row from audit_log where table_name='submissions' and operation='UPDATE' order by id desc limit 1");assert.equal(logs[0].old_row.storage_path,first.submission.storage_path);
});
test('pending rows have no submission status, a new begin supersedes, and service verification cannot be forged',async()=>{
  await clear();const old=await h.begin(),latest=await h.begin();assert.notEqual(old.id,latest.id);
  assert.equal((await h.rows('select id from pending_uploads')).length,1);assert.deepEqual((await h.rpc('class_data')).submissions,[]);
  await assert.rejects(h.rpc('finish_submission',old.id),/not found/);
  await assert.rejects(h.rpc('finish_submission',latest.id),/verified/);
  await assert.rejects(h.rpc('confirm_submission_upload',latest.id,10,'application/pdf'),/permission denied/);
  await assert.rejects(h.rows('select verification_receipt from pending_uploads'),/permission denied/);
  await h.as('owner');await h.rows("update pending_uploads set expires_at=now()-interval '1 second' where id=$1",[latest.id]);
  await h.as('a');await assert.rejects(h.rpc('finish_submission',latest.id),/expired/);
  await h.as('teacher');await h.rpc('configure_grade_item',1,'link','individual',null,null); // pending rows never block mode edits
  await h.rpc('configure_grade_item',1,'file','individual',null,null);
});
test('individual reads, active pending storage paths, size/type limits, and expired sweeps are enforced',async()=>{
  await clear();const p=await h.begin();await h.rows("insert into storage.objects(bucket_id,name) values('submissions',$1)",[p.storage_path]);
  assert.deepEqual(await h.rows('select * from storage.objects'),[]);
  await assert.rejects(h.rows("insert into storage.objects(bucket_id,name) values('submissions','invented.pdf')"),/row-level security/);
  await h.as('b');await assert.rejects(h.rows("insert into storage.objects(bucket_id,name) values('submissions',$1)",[p.storage_path]),/row-level security/);
  await h.as('a');await assert.rejects(h.rpc('begin_submission',1,'too-big.pdf',26*1024*1024,'application/pdf'),/25 MB/);
  await assert.rejects(h.rpc('begin_submission',1,'bad.exe',10,'application/pdf'),/25 MB/);
  const s=(await h.finish(p)).submission;await h.as('b');assert.deepEqual(await h.rows('select id from submissions'),[]);
  const pending=await h.begin();await h.rows("insert into storage.objects(bucket_id,name) values('submissions',$1)",[pending.storage_path]);
  await h.as('owner');await h.rows("update pending_uploads set expires_at=now()-interval '1 second' where id=$1",[pending.id]);
  const bucket=(await h.rows("select * from storage.buckets where id='submissions'"))[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),25*1024*1024);assert.equal(bucket.allowed_mime_types.length,5);
  await h.as('service');assert.ok((await h.rpc('submission_sweep_candidates')).includes(pending.storage_path));
  assert.ok(!(await h.rpc('submission_sweep_candidates')).includes(s.storage_path));
  assert.deepEqual(await h.rpc('reject_submission_upload',p.id),[]); // duplicate finish cleanup cannot remove committed work
});
test('grading locks an existing submission, unreleasing keeps the lock, and deleting all scores unlocks',async()=>{
  await clear();const first=(await h.finish(await h.begin())).submission;
  const pending=await h.begin();const receipt=await h.verify(pending);
  await h.as('grader');await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:8,comment:'Clear analysis'}]));
  await h.as('a');await assert.rejects(h.rpc('finish_submission',pending.id,receipt),/Graded, locked/);await assert.rejects(h.rpc('begin_submission',1,'new.pdf',10,'application/pdf'),/Graded, locked/);
  assert.equal((await h.rows('select storage_path from submissions'))[0].storage_path,first.storage_path);
  let d=await h.rpc('class_data');assert.deepEqual(d.grades,[]);assert.equal(d.submissions[0].status,'Submitted');assert.ok(!JSON.stringify(d).includes('Clear analysis'));
  await h.as('teacher');await h.rpc('release_grade_item',1,true);await h.as('a');assert.equal((await h.rpc('class_data')).grades[0].comment,'Clear analysis');
  await h.as('teacher');await h.rpc('release_grade_item',1,false);await h.as('a');await assert.rejects(h.rpc('begin_submission',1,'new.pdf',10,'application/pdf'),/Graded, locked/);
  await h.as('grader');await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:null}]));await h.begin();
  // A grade without any submitted work must not invent a submission or pending lock.
  await h.as('grader');await h.rpc('save_grades',JSON.stringify([{uni:'bb1002',item_id:1,score:0}]));await h.begin('b');
});
test('group replacement preserves the last on-time work and current membership controls access',async()=>{
  await clear();const {set,groups}=await group();await h.as('teacher');await h.rpc('choose_group',set,null,'cc1003');
  await due(2,'2020-01-01T14:00Z');let p=await h.begin('a',2);await startAt(p,'2020-01-01T13:50Z');const first=(await h.finish(p)).submission;
  p=await h.begin('b',2);await startAt(p,'2020-01-01T14:05Z');const second=(await h.finish(p,'b')).submission;
  assert.equal(second.late,true);assert.equal(second.on_time_path,first.storage_path);assert.equal(new Date(second.on_time_started_at).toISOString(),'2020-01-01T13:50:00.000Z');
  await h.as('c');assert.deepEqual(await h.rows('select id from submissions'),[]);await assert.rejects(h.rpc('begin_submission',2,'work.pdf',10,'application/pdf'),e=>e.code==='P0002' && /Join a group first/.test(e.message));
  await assert.rejects(h.rpc('choose_group',set,groups[0].id),/closed/);
  await h.as('teacher');await h.rpc('choose_group',set,groups[0].id,'cc1003');
  await h.as('c');assert.equal((await h.rpc('class_data')).submissions.length,1);
  await assert.rejects(h.rows('select member_unis,submitted_by from submissions'),/permission denied/);
  assert.equal('member_unis' in (await h.rpc('class_data')).submissions[0],false);
});
test('group grading fans out to four snapshot members, survives a move, and supports one-member overrides',async()=>{
  await clear();const {set,groups}=await group(3);await h.finish(await h.begin('a',3));
  await h.as('teacher');await h.rpc('choose_group',set,groups[1].id,'dd1004');
  await h.as('grader');await h.rpc('grade_group',3,groups[0].id,9,'Shared feedback');
  const grades=await h.rows('select uni,score,comment from grades order by uni');assert.equal(grades.length,4);assert.ok(grades.every(g=>Number(g.score)===9 && g.comment==='Shared feedback'));
  assert.equal((await h.rpc('class_data')).submissions[0].membership_changed,true);
  await h.rpc('save_grades',JSON.stringify([{uni:'bb1002',item_id:3,score:7,comment:'Individual feedback'}]));
  assert.deepEqual((await h.rows('select score from grades order by uni')).map(g=>Number(g.score)),[9,7,9,9]);
  await h.as('d');assert.deepEqual((await h.rpc('class_data')).submissions,[]);assert.deepEqual((await h.rpc('class_data')).grades,[]);
  await h.as('grader');await assert.rejects(h.rpc('release_grade_item',3,true),/Instructor/);
  await h.as('teacher');await h.rpc('release_grade_item',3,true);await h.as('d');assert.equal((await h.rpc('class_data')).grades[0].comment,'Shared feedback');
  await h.as('teacher');const other=await h.rpc('create_group_set','Other set',1,4,null);const bad=(await h.rpc('class_data')).groups.find(g=>g.set_id===other);
  await h.as('grader');await assert.rejects(h.rpc('grade_group',3,bad.id,8,'Wrong set'),/does not belong/);
  await h.rpc('grade_group',3,groups[0].id,null,null);await h.begin('a',3);
});
test('https links, preview, auditor, and unlisted denial cover each submission write RPC',async()=>{
  await clear();await group(6);await h.as('a');
  for(const url of ['http://example.test','javascript:alert(1)','https://','https://example.test/a b'])await assert.rejects(h.rpc('submit_link',6,url),/https/);
  assert.equal((await h.rpc('submit_link',6,'https://example.test/video')).submission.link,'https://example.test/video');
  for(const who of ['auditor','outside','teacher','grader']){await h.as(who);for(const [fn,args] of [['begin_submission',[1,'a.pdf',10,'application/pdf']],['finish_submission',['00000000-0000-0000-0000-000000000001']],['submit_link',[6,'https://example.test']]])await assert.rejects(h.rpc(fn,...args),/Student access/);}
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  for(const [fn,args] of [['begin_submission',[1,'a.pdf',10,'application/pdf']],['finish_submission',['00000000-0000-0000-0000-000000000001']],['submit_link',[6,'https://example.test']],['grade_group',[6,(await h.rpc('class_data')).groups[0].id,2,null]]])await assert.rejects(h.rpc(fn,...args),/read-only/);
  await h.rpc('set_student_preview',null);
});

test('new tables have preview guards, immutable audit records and no table-wide browser grants',async()=>{
  await clear();const p=await h.begin();await h.finish(p);
  await h.as('owner');
  for(const table of ['terms','submissions','pending_uploads']) {
    const triggers=await h.rows('select tgname from pg_trigger where tgrelid=$1::regclass and not tgisinternal',[table]);
    assert.ok(triggers.some(t=>t.tgname==='preview_guard'),table);
    assert.ok(triggers.some(t=>/audit/.test(t.tgname)),table);
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await h.rows("select has_table_privilege('authenticated',$1,$2) allowed",[table,privilege]))[0].allowed,false,`${table}: ${privilege}`);
  }
  const audit=await h.rows("select * from audit_log where table_name in ('submissions','pending_uploads')");
  assert.ok(audit.some(a=>a.table_name==='submissions' && a.operation==='INSERT'));
  assert.ok(audit.some(a=>a.table_name==='pending_uploads' && a.operation==='DELETE'));
  assert.ok(audit.every(a=>!('verification_receipt' in (a.new_row || {})) && !('verification_receipt' in (a.old_row || {}))));
});
