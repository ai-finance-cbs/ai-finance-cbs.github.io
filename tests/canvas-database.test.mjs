import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {canvasFixture} from './fixtures/canvas.mjs';
let h;
before(async()=>{h=await phaseDatabase();}); after(async()=>h?.db.close());
beforeEach(async()=>{await h.as('owner');await h.db.exec('begin');});
afterEach(async()=>{await h.db.exec('rollback; reset role');});
const tables=['courses','assignment_map','enrollments','assignments','submissions','groups','group_members','sync_runs'];
async function deny(fn,pattern=/permission denied|Staff|Instructor|preview|active term|constraint|assignment|running|lease|snapshot|access changed/i) {
  await h.db.exec('savepoint denied');try {await assert.rejects(fn,pattern);}finally{await h.db.exec('rollback to denied; release savepoint denied');}
}
async function start() {await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);return h.rpc('request_canvas_sync',TERM);}
async function publish(run,snapshot=normalizeSnapshot(canvasFixture())) {await h.as('service');return h.rpc('publish_canvas_sync',run.id,JSON.stringify(snapshot));}
async function staff() {await h.as('teacher');return h.rpc('canvas_staff_data',TERM);}

test('snapshot publishes all collections once, matches only the roster, and never changes legacy student data',async()=>{
  await h.as('a');const before=await h.rpc('class_data');
  const run=await start(),counts=await publish(run);assert.equal(counts.enrollments,6);assert.equal(counts.assignments,13);assert.equal(counts.submissions,78);
  const d=await staff();assert.equal(d.course.generation,run.id);assert.equal(d.enrollments.filter(e=>e.match_status==='matched').length,4);
  assert.equal(d.enrollments.filter(e=>e.match_status==='unmatched').length,2);
  assert.deepEqual(await publish(run),counts);assert.equal((await staff()).submissions.length,78);
  await h.as('a');assert.deepEqual(await h.rpc('class_data'),before);
});
for(const role of ['grader','a','auditor','outside','anon','preview']) test(`${role} Canvas read/write boundary`,async()=>{
  const run=await start();await publish(run);
  if(role==='preview'){await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);}else await h.as(role);
  for(const table of tables) {
    if(role==='anon') await deny(()=>h.rows(`select * from canvas_${table}`));
    else assert.equal((await h.rows(`select * from canvas_${table}`)).length>0,role==='grader' && table!=='assignment_map');
    await deny(()=>h.rows(`insert into canvas_${table} default values`));
    await deny(()=>h.rows(`delete from canvas_${table}`));
    await deny(()=>h.rows(`update canvas_${table} set term_id=term_id`));
  }
  if(role==='grader')assert.equal((await h.rpc('canvas_staff_data',TERM)).submissions.length,78);
  else await deny(()=>h.rpc('canvas_staff_data',TERM));
  await deny(()=>h.rpc('save_canvas_course',TERM,123,true));
  await deny(()=>h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1));
  await deny(()=>h.rpc('request_canvas_sync',TERM));
  await deny(()=>h.rpc('begin_canvas_sync',TERM));
  await deny(()=>h.rpc('publish_canvas_sync',run.id,'{}'));
  await deny(()=>h.rpc('fail_canvas_sync',run.id,'failed','forged'));
});
test('instructor mappings validate IDs, unique destinations, kind/week pairs, and removal',async()=>{
  await publish(await start());await h.as('teacher');
  await h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1);
  await h.rpc('save_canvas_mapping',TERM,'Q6',101,'quiz',6);
  for(const args of [['M2',100,'milestone',2],['M2',999,'milestone',2],['Q6',102,'quiz',5],['FP',102,'final',null],['Other',102,'optional',null],['Q7',102,'quiz',7]])await deny(()=>h.rpc('save_canvas_mapping',TERM,...args));
  assert.equal((await h.rpc('canvas_staff_data',TERM)).mappings.length,2);
  await h.rpc('save_canvas_mapping',TERM,'M1',null,'milestone',1);assert.equal((await h.rpc('canvas_staff_data',TERM)).mappings.length,1);
  await deny(()=>h.rpc('save_canvas_course',TERM,0),/valid Canvas course ID/);
  await deny(()=>h.rows("insert into canvas_courses(term_id,course_id) values('spring-2027',1)"));
  const audits=await h.rows("select * from audit_log where table_name='canvas_assignment_map'");assert.equal(audits.length,3);
});
test('partial and invalid generations roll back; unposting, corrected scores, and removals replace the old generation',async()=>{
  await publish(await start());await h.as('teacher');const run=await h.rpc('request_canvas_sync',TERM),before=await h.rpc('canvas_staff_data',TERM);
  await h.as('service');await deny(()=>h.rpc('publish_canvas_sync',run.id,'{"assignments":[]}'));
  const broken=normalizeSnapshot(canvasFixture());broken.submissions[1].workflow_state='broken';
  await deny(()=>publish(run,broken));assert.deepEqual((await staff()).submissions,before.submissions);
  const changed=normalizeSnapshot(canvasFixture());changed.submissions[0].posted_at=null;changed.submissions[1].assignment_visible=false;
  changed.submissions[2].missing=true;changed.submissions[3].late_policy_status='missing';changed.submissions[4].score=null;
  changed.groups=[];changed.group_members=[];
  await publish(run,changed);const after=await staff();
  for(const i of [0,1]) assert.equal(after.submissions.find(s=>String(s.assignment_id)===String(changed.submissions[i].assignment_id) && s.user_id===1).posted_visible,false);
  for(const i of [2,3,4]) assert.equal(after.submissions.find(s=>String(s.assignment_id)===String(changed.submissions[i].assignment_id) && s.user_id===1).quiz_present,false);
  assert.equal(after.submissions.find(s=>s.assignment_id===100 && s.user_id===2).quiz_present,true);
  assert.equal(after.groups.length,0);
});
test('leases reject overlap, expire abandoned runs, and reject old workers',async()=>{
  const old=await start();await deny(()=>h.rpc('request_canvas_sync',TERM));
  await h.as('owner');await h.rows("update canvas_sync_runs set started_at=now()-interval '11 minutes' where id=$1",[old.id]);
  await h.as('service');const fresh=await h.rpc('begin_canvas_sync',TERM);
  await deny(()=>publish(old));await publish(fresh);
  const d=await staff();assert.equal(d.course.generation,fresh.id);assert.equal(d.runs.find(r=>r.id===old.id).status,'failed');
});
test('rollover and preview during fetch cannot publish, mappings stay term-local, and secrets never enter tables',async()=>{
  const run=await start();await h.rpc('set_student_preview','aa1001',TERM);await deny(()=>publish(run));
  await h.as('teacher');await h.rpc('set_student_preview',null,TERM);await h.rpc('open_term','Spring 2028');
  await deny(()=>publish(run));await h.as('teacher');await deny(()=>h.rpc('save_canvas_mapping',TERM,'Q6',101,'quiz',6));
  const fresh=await h.rpc('canvas_staff_data','spring-2028');assert.equal(fresh.course,null);assert.deepEqual(fresh.mappings,[]);
  await h.as('owner');const columns=await h.rows("select column_name from information_schema.columns where table_name like 'canvas_%'");
  assert.ok(!columns.some(c=>/token|secret|comment|body|notes/.test(c.column_name)));
});
test('RPC grants, RLS, fixed search paths, preview and audit triggers cover all Canvas tables',async()=>{
  await h.as('owner');
  const rows=await h.rows("select relname,relrowsecurity from pg_class where relname = any($1::text[])",[tables.map(t=>'canvas_'+t)]);
  assert.equal(rows.length,8);assert.ok(rows.every(r=>r.relrowsecurity));
  const funcs=await h.rows("select proname,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and proname like '%canvas%'");
  assert.ok(funcs.every(f=>f.prosecdef && f.proconfig.includes('search_path=""')));
  const triggers=await h.rows("select event_object_table,trigger_name from information_schema.triggers where event_object_table like 'canvas_%'");
  for(const name of tables.map(t=>'canvas_'+t))for(const trigger of ['preview_guard','change_audit'])assert.ok(triggers.some(t=>t.event_object_table===name&&t.trigger_name===trigger));
});

test('each generation clears stale roster links and rejects ambiguous Canvas logins',async()=>{
  await publish(await start());await h.as('teacher');const run=await h.rpc('request_canvas_sync',TERM);
  const snapshot=normalizeSnapshot(canvasFixture());
  snapshot.enrollments[0].login_id=null;
  snapshot.enrollments[2].login_id=snapshot.enrollments[1].login_id;
  await publish(run,snapshot);const d=await staff();
  const missing=d.enrollments.find(e=>String(e.user_id)===snapshot.enrollments[0].user_id);
  assert.equal(missing.uni,null);assert.equal(missing.match_status,'unmatched');
  for(const e of snapshot.enrollments.slice(1,3)){
    const actual=d.enrollments.find(row=>String(row.user_id)===e.user_id);
    assert.equal(actual.uni,null);assert.equal(actual.match_status,'ambiguous');
  }
});

test('course reset clears only the active term mirror and mappings, retains history, and audits every deletion',async()=>{
  await publish(await start());await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1);
  await h.rpc('open_term','Spring 2028');const current='spring-2028',archived=await h.rpc('canvas_staff_data',TERM);
  await h.rpc('save_canvas_course',current,240315);const run=await h.rpc('request_canvas_sync',current);await publish(run);
  await h.as('teacher');await h.rpc('save_canvas_mapping',current,'M1',100,'milestone',1);
  const legacy=await h.rpc('class_data',current);
  await deny(()=>h.rpc('save_canvas_course',TERM,240316,true),/active term/);
  await h.rpc('save_canvas_course',current,240316,true);const reset=await h.rpc('canvas_staff_data',current);
  assert.equal(reset.course.course_id,240316);assert.equal(reset.course.generation,null);assert.equal(reset.course.last_synced_at,null);
  for(const key of ['assignments','submissions','enrollments','groups','group_members','mappings'])assert.deepEqual(reset[key],[]);
  assert.deepEqual(await h.rpc('canvas_staff_data',TERM),archived);assert.deepEqual(await h.rpc('class_data',current),legacy);
  assert.equal(reset.runs.length,2);assert.equal(reset.runs[0].status,'reset');assert.ok(reset.runs[0].finished_at);
  assert.deepEqual(reset.runs[0].counts,{submissions:78,group_members:2,assignment_map:1,assignments:13,enrollments:6,groups:1});
  for(const [name,count] of Object.entries(reset.runs[0].counts)) {
    const audits=await h.rows("select * from audit_log where table_name=$1 and operation='DELETE' and old_row->>'term_id'=$2",['canvas_'+name,current]);
    assert.equal(audits.length,count);assert.ok(audits.every(a=>a.actor_email==='oh@gsb.columbia.edu'));
  }
  const courses=await h.rows("select * from audit_log where table_name='canvas_courses' and operation='UPDATE' and new_row->>'term_id'=$1",[current]);
  assert.ok(courses.some(a=>a.old_row.course_id===240315 && a.new_row.course_id===240316 && a.new_row.generation===null));
  assert.equal((await h.rows("select * from audit_log where table_name='canvas_sync_runs' and new_row->>'status'='reset'")).length,1);
  // A fresh sync uses the new course and starts without old mappings.
  const next=await h.rpc('request_canvas_sync',current);assert.equal(next.course_id,240316);await publish(next);
  await h.as('teacher');assert.equal((await h.rpc('canvas_staff_data',current)).assignments.length,13);
  assert.deepEqual((await h.rpc('canvas_staff_data',current)).mappings,[]);
});

test('same-course saves retain copied data; live leases block resets and expired workers cannot publish after reset',async()=>{
  await publish(await start());const before=await staff();await h.rpc('save_canvas_course',TERM,240315);
  const unchanged=await staff();assert.equal(unchanged.course.generation,before.course.generation);
  assert.deepEqual(unchanged.submissions,before.submissions);assert.deepEqual(unchanged.runs,before.runs);
  for(const confirm of [undefined,false,null])await deny(()=>h.rpc('save_canvas_course',TERM,240316,...(confirm===undefined?[]:[confirm])),/Confirm the Canvas/);
  assert.deepEqual((await staff()).submissions,before.submissions);
  const running=await h.rpc('request_canvas_sync',TERM);
  await deny(()=>h.rpc('save_canvas_course',TERM,240316,true),/current sync/);
  assert.equal((await staff()).course.course_id,240315);assert.equal((await staff()).submissions.length,78);
  await h.as('owner');await h.rows("update canvas_sync_runs set started_at=clock_timestamp()-interval '11 minutes' where id=$1",[running.id]);
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240316,true);
  assert.equal((await staff()).runs.find(r=>r.id===running.id).status,'failed');
  await deny(()=>publish(running),/lease/);assert.deepEqual((await staff()).submissions,[]);
});

test('a failed reset rolls back copied data, mappings, course metadata, and audits together',async()=>{
  await publish(await start());await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1);
  const before=await staff(),audits=await h.rows('select count(*)::int n from audit_log');
  await h.as('owner');await h.db.exec(`create function pg_temp.reject_canvas_reset() returns trigger language plpgsql as $$
    begin if new.status='reset' then raise exception 'Injected reset failure'; end if; return new; end $$;
    create trigger test_reset_failure before insert on canvas_sync_runs for each row execute function pg_temp.reject_canvas_reset();`);
  await h.as('teacher');await deny(()=>h.rpc('save_canvas_course',TERM,240316,true),/Injected reset failure/);
  assert.deepEqual(await staff(),before);assert.deepEqual(await h.rows('select count(*)::int n from audit_log'),audits);
});
