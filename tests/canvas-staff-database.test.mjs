import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {canvasFixture} from './fixtures/canvas.mjs';
import {canvasStudentStatus} from '../assets/materials/canvas-core.js';
let h;
before(async()=>{
  h=await phaseDatabase(undefined,'019_canvas_student_views.sql');
  await h.as('teacher');await h.rpc('save_grades','[{"uni":"aa1001","item_id":7,"score":2},{"uni":"aa1001","item_id":1,"score":8}]');
  await h.rpc('release_grade_item',1,true);
  await h.as('owner');await h.db.exec(readFileSync(new URL('../supabase/migrations/020_canvas_staff_attendance.sql',import.meta.url),'utf8'));
});
after(async()=>h?.db.close());
beforeEach(async()=>{await h.as('owner');await h.db.exec('begin');});
afterEach(async()=>{await h.db.exec('rollback; reset role');});
async function deny(task,pattern=/permission denied|Instructor|preview.*read-only/i){await h.db.exec('savepoint deny');try{await assert.rejects(task,pattern);}finally{await h.db.exec('rollback to deny; release savepoint deny');}}
async function publish(raw=canvasFixture()) {
  await h.as('service');const run=await h.rpc('begin_canvas_sync',TERM);
  await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));return run;
}
async function seed(change=()=>{}) {
  const raw=canvasFixture();change(raw);
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);await publish(raw);
  await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1);await h.rpc('save_canvas_mapping',TERM,'Q1',101,'quiz',1);return raw;
}
const attendance=async(uni='aa1001')=>{await h.as('teacher');return (await h.rpc('class_data',TERM)).attendance.find(a=>a.uni===uni&&a.week===1);};
const audit=async()=>{await h.as('teacher');return h.rows("select * from audit_log where table_name='attendance' order by id");};
const student=async()=>{await h.as('a');return h.rpc('canvas_student_data',TERM);};
const target=raw=>raw.submissions.find(s=>s.user_id===1&&s.assignment_id===101);

test('unposted excused/missing/late grading flags cannot change student status; posting restores decisions',async()=>{
  const raw=await seed();const s=raw.submissions[0];
  for(const [fields,expected] of [
    [{excused:true,late_policy_status:'missing',missing:true,late:true,posted_at:null},'Done'],
    [{workflow_state:'unsubmitted',submitted_at:null},Date.now()<Date.parse(s.cached_due_at || raw.assignments[0].due_at)?'Not yet due':'Missing'],
    [{workflow_state:'submitted',submitted_at:'2027-03-02T14:00:00Z'},'Late'],
    [{posted_at:'2027-03-03T14:00:00Z'},'Excused'],
  ]) {
    Object.assign(s,fields);await publish(raw);const row=(await student()).items.find(i=>i.site_key==='M1');assert.equal(row.status,expected);if(!s.posted_at)assert.equal(row.score,null);
  }
});
test('SQL and demo status masking agree for unposted receipt, due, optional, paper, and posted outcomes',async()=>{
  const now=Date.parse('2027-03-01T14:00:00Z');
  const base={assignment_visible:true,posted_visible:false,workflow_state:'unsubmitted',cached_due_at:'2027-03-01T14:00:00Z',submitted_at:null,excused:true,late:true,missing:true,late_policy_status:'missing'};
  for(const [change,kind,expected] of [[{},'milestone','Missing'],[{cached_due_at:'2027-03-02T14:00:00Z'},'milestone','Not yet due'],[{cached_due_at:null},'milestone','No due date'],[{},'optional','Optional'],[{workflow_state:'graded'},'quiz','Missing'],[{workflow_state:'graded',submission_types:['on_paper']},'quiz','Not posted'],[{submission_types:['none']},'participation','Not posted'],[{submission_types:['external_tool']},'quiz','Not posted'],[{submission_types:['external_tool'],workflow_state:'pending_review'},'quiz','Done'],[{submission_types:['on_paper','online_upload']},'quiz','Missing'],[{submitted_at:'2027-02-28T14:00:00Z'},'milestone','Done'],[{submitted_at:'2027-03-01T14:00:01Z'},'milestone','Late'],[{posted_visible:true},'milestone','Excused'],[{assignment_visible:false},'milestone','Status unavailable']]) {
    const s={...base,...change};assert.equal(canvasStudentStatus(s,{kind,submission_types:s.submission_types},now),expected);
    assert.equal((await h.rows('select private.canvas_student_status($1,$2,$3) value',[JSON.stringify(s),kind,new Date(now).toISOString()]))[0].value,expected);
  }
});
test('reset followed by a young running lease remains unavailable',async()=>{
  await seed();await h.as('teacher');await h.rpc('save_canvas_course',TERM,240316,true);
  await h.as('service');await h.rpc('begin_canvas_sync',TERM);
  const d=await student();assert.equal(d.available,false);assert.equal(d.last_synced_at,null);assert.deepEqual(d.items,[]);assert.deepEqual(d.groups,[]);
});
test('quiz mapping replaces local scores: ordinary zero and paper score qualify, missing-policy zero does not',async()=>{
  await seed(raw=>{Object.assign(target(raw),{score:0,missing:true,late_policy_status:'missing'});Object.assign(raw.submissions.find(s=>s.user_id===2&&s.assignment_id===101),{score:0,submitted_at:null,workflow_state:'graded'});});
  assert.equal(await attendance(),undefined);assert.equal((await attendance('bb1002')).status,'present');assert.equal((await attendance('cc1003')).status,'present');
  await h.as('teacher');await h.rpc('save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"Approved"}]');assert.equal((await attendance()).status,'excused');
});
test('quiz arrival overrides an excuse once; identical syncs produce no attendance audit rows; withdrawal never resurrects the excuse',async()=>{
  const raw=await seed(raw=>{target(raw).score=null;});
  await h.as('teacher');await h.rpc('save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"Approved"}]');
  target(raw).score=0;await publish(raw);const present=await attendance();assert.equal(present.status,'present');assert.equal(present.excuse_reason,null);
  let rows=await audit();assert.equal(rows.at(-1).old_row.excuse_reason,'Approved');const count=rows.length;
  await publish(raw);assert.equal((await audit()).length,count);
  await h.as('teacher');await deny(()=>h.rpc('save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"No"}]'),/Present attendance/);
  target(raw).score=null;await publish(raw);assert.equal(await attendance(),undefined);assert.equal((await audit()).length,count+1);
});
test('missing quiz rows, mappings, course resets, and enrollment matches clear Canvas presence',async()=>{
  const raw=await seed();assert.equal((await attendance()).status,'present');
  raw.submissions=raw.submissions.filter(s=>s!==target(raw));await publish(raw);assert.equal(await attendance(),undefined);
  await publish();await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'Q1',null,'quiz',1);assert.equal(await attendance(),undefined);
  await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'Q1',101,'quiz',1);assert.equal((await attendance()).status,'present');
  const changed=canvasFixture();changed.enrollments[0].user.login_id='notmatched';await publish(changed);assert.equal(await attendance(),undefined);
  await publish();await h.as('teacher');await h.rpc('save_canvas_course',TERM,240316,true);assert.equal(await attendance(),undefined);
});
test('failed and rejected publications preserve prior attendance; an error rolls snapshot and attendance back together',async()=>{
  const raw=await seed();const original=await attendance();await h.as('service');const run=await h.rpc('begin_canvas_sync',TERM);
  const broken=normalizeSnapshot(raw);broken.groups[0].id=null;
  await deny(()=>h.rpc('publish_canvas_sync',run.id,JSON.stringify(broken)),/null|constraint/);
  await h.rpc('fail_canvas_sync',run.id,'failed','Synthetic error');assert.deepEqual(await attendance(),original);
});
for(const who of ['teacher','grader','a','auditor','outside','anon','service','preview'])test(`${who} cannot write archived grades, release, groups or roster, or invoke private attendance helpers`,async()=>{
  if(who==='preview'){await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);}else await h.as(who);
  for(const [fn,...args] of [['save_grades','[{"uni":"aa1001","item_id":7,"score":1}]'],['release_grade_item',1,true],['grade_group',1,null,5,null],['replace_roster','[]'],['choose_group',null,null,null]])await deny(()=>h.rpc(fn,...args),/permission denied/);
  await deny(()=>h.rows('select private.refresh_canvas_attendance($1)',[TERM]),/permission denied/);
  if(!['teacher','service'].includes(who))await deny(()=>h.rpc('save_attendance',1,'[]'));
  if(who!=='service')await deny(()=>h.rows("insert into storage.objects(bucket_id,name) values('submissions','forged.pdf')"),/row-level security/);
});
test('staff still read archived local grades and current Canvas; student and preview mask unposted provenance and reasons',async()=>{
  await seed(raw=>{target(raw).posted_at=null;});
  for(const who of ['teacher','grader']){await h.as(who);assert.equal((await h.rpc('class_data',TERM)).grades.length,2);assert.equal((await h.rpc('canvas_staff_data',TERM)).enrollments.length,6);}
  await h.as('a');const a=(await h.rpc('class_data',TERM)).attendance[0];assert.equal(a.status,'pending');assert.equal(a.source_quiz,null);assert.ok(!('excuse_reason' in a));
  await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);assert.deepEqual((await h.rpc('class_data',TERM)).attendance[0],a);
});
test('new term sync and instructor excuses cannot change archived attendance',async()=>{
  await seed();const before=await attendance();await h.as('teacher');await h.rpc('open_term','Spring 2028');
  await h.as('owner');await h.rows("insert into roster(term_id,uni,name) values('spring-2028','aa1001','Alice')");
  await h.as('teacher');await h.rpc('save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"New term"}]');
  assert.deepEqual((await h.rpc('class_data',TERM)).attendance.find(a=>a.uni==='aa1001'&&a.week===1),before);
});

test('C1: attendance is identical for unposted quiz absence, scores, missing-policy zeros, and row deletion',async()=>{
  const raw=await seed(raw=>{raw.assignments.find(a=>a.id===101).submission_types=['on_paper'];Object.assign(target(raw),{score:null,submitted_at:null,posted_at:null,workflow_state:'unsubmitted'});});
  const read=async who=>{await h.as(who);return (await h.rpc('class_data',TERM)).attendance;};
  const expected=[{uni:'aa1001',week:1,status:'pending',source_quiz:null,manual_override:null}];
  assert.deepEqual(await read('a'),expected);assert.equal(await attendance(),undefined);
  const projected=(await student()).items.find(i=>i.site_key==='Q1');assert.equal(projected.status,'Not posted');
  for(const fields of [{score:0,workflow_state:'graded'},{missing:true,late_policy_status:'missing'},{score:null}]) {
    Object.assign(target(raw),fields);await publish(raw);
    assert.deepEqual(await read('a'),expected);
    assert.deepEqual((await student()).items.find(i=>i.site_key==='Q1'),projected);
    assert.equal((await attendance())?.status,fields.score===0?'present':undefined);
    await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);
    assert.deepEqual((await h.rpc('class_data',TERM)).attendance,expected);
    assert.deepEqual((await h.rpc('view_as_student','aa1001')).attendance,expected);
    assert.deepEqual((await h.rpc('canvas_student_data',TERM)).items.find(i=>i.site_key==='Q1'),projected);
    assert.deepEqual(await h.rows('select * from attendance'),[]);
    await h.rpc('set_student_preview',null,null);
  }
  raw.submissions=raw.submissions.filter(s=>s!==target(raw));await publish(raw);assert.deepEqual(await read('a'),expected);
});
test('C1: posting reveals attendance; unposting hides it; instructor excuses remain visible with no reason',async()=>{
  const raw=await seed(raw=>Object.assign(target(raw),{score:null,posted_at:null}));
  await h.as('teacher');await h.rpc('save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"PRIVATE"}]');
  await h.as('a');let rows=(await h.rpc('class_data',TERM)).attendance;assert.equal(rows[0].status,'excused');assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  Object.assign(target(raw),{score:0,posted_at:null});await publish(raw);
  await h.as('a');assert.equal((await h.rpc('class_data',TERM)).attendance[0].status,'pending');
  target(raw).posted_at='2027-03-02T14:00:00Z';await publish(raw);
  await h.as('a');rows=(await h.rpc('class_data',TERM)).attendance;assert.equal(rows[0].status,'present');assert.equal(rows[0].source_quiz,1);
  target(raw).missing=true;await publish(raw);await h.as('a');assert.deepEqual((await h.rpc('class_data',TERM)).attendance,[]);
  target(raw).posted_at=null;await publish(raw);await h.as('a');assert.equal((await h.rpc('class_data',TERM)).attendance[0].status,'pending');
});
test('C1: submission types already survive normalization and publication; unposted offline work never says Missing or Late',async()=>{
  const raw=await seed();const a=raw.assignments[0],s=raw.submissions[0];
  Object.assign(s,{submitted_at:null,posted_at:null,workflow_state:'graded',missing:true,late:true,late_policy_status:'late'});
  for(const types of [['on_paper'],['none'],['external_tool'],['on_paper','none']]) {
    a.submission_types=types;await publish(raw);
    assert.equal((await student()).items.find(i=>i.site_key==='M1').status,'Not posted');
    await h.as('teacher');assert.deepEqual((await h.rpc('canvas_staff_data',TERM)).assignments.find(a=>a.id===100).submission_types,types);
  }
  a.submission_types=['online_upload'];await publish(raw);assert.notEqual((await student()).items[0].status,'Done');
  a.submission_types=['external_tool'];Object.assign(s,{workflow_state:'submitted',submitted_at:'2027-02-28T14:00:00Z'});await publish(raw);assert.equal((await student()).items[0].status,'Done');
  a.submission_types=['on_paper'];await publish(raw);assert.equal((await student()).items[0].status,'Not posted');
  s.posted_at='2027-03-02T14:00:00Z';await publish(raw);assert.equal((await student()).items[0].status,'Missing');
});
test('C1: authenticated has no EXECUTE grants on retired grade or roster functions',async()=>{
  for(const signature of ['public.grade_group(integer,uuid,numeric,text)','public.save_grades(jsonb)','public.release_grade_item(integer,boolean)','public.replace_roster(jsonb)','private.canvas_quiz_posted(text,text,integer)']) {
    assert.equal((await h.rows("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[signature]))[0].allowed,false,signature);
  }
});
