import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {canvasFixture} from './fixtures/canvas.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {surveyFixture} from './fixtures/survey.mjs';
import {emptySurvey,TEXT_LIMITS} from '../assets/materials/survey-core.js';
let h;
before(async()=>{
  h=await phaseDatabase();const raw=canvasFixture();raw.assignments.forEach(a=>{a.due_at=new Date(Date.now()+86400000).toISOString();});
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);const run=await h.rpc('request_canvas_sync',TERM);
  await h.as('service');await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));
  await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1);
});
after(async()=>h?.db.close());beforeEach(async()=>{await h.as('owner');await h.db.exec('begin');});afterEach(async()=>{await h.db.exec('rollback; reset role');});
async function deny(fn,pattern=/permission denied|access required|preview|active term|read-only|closed|deadline|Invalid survey|constraint/i){
  await h.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await h.db.exec('rollback to denied; release savepoint denied');}
}
const save=(v=surveyFixture(),submit=true,term=TERM)=>h.rpc('save_m1_survey',term,JSON.stringify(v),submit);
test('identity comes from the session, name remains editable, and draft/submit/resubmit are audited',async()=>{
  await h.as('a');let own=await h.rpc('my_m1_survey',TERM);assert.equal(own.roster_name,'Alice');assert.equal(own.uni,'aa1001');
  const value={...emptySurvey('Edited name'),uni:'bb1002',term_id:'other'};const draft=await save(value,false);assert.equal(draft.uni,'aa1001');assert.equal(draft.term_id,TERM);assert.equal(draft.answers.full_name,'Edited name');
  const first=await save(),second=await save();assert.notEqual(first.submitted_at,second.submitted_at);assert.equal(second.status,'submitted');
  assert.deepEqual((await h.rpc('my_m1_survey',TERM)).submission,second);
  await h.as('b');assert.equal((await h.rpc('my_m1_survey',TERM)).submission,null);
  await h.as('teacher');const data=await h.rpc('m1_survey_class',TERM);assert.equal(data.students.length,4);assert.equal(data.students.filter(s=>s.submission).length,1);
  const audit=await h.rows("select * from audit_log where table_name='m1_survey_responses'");assert.equal(audit.length,3);assert.ok(audit.every(r=>r.actor_email==='aa1001@columbia.edu'));
  await h.as('a');assert.equal((await save(emptySurvey(),false)).submitted_at,null);
});
for(const role of ['a','b','teacher','grader','auditor','outside','anon'])test(`${role}: raw table and RPC permissions`,async()=>{
  await h.as(role);for(const sql of ['select * from m1_survey_responses','insert into m1_survey_responses default values','update m1_survey_responses set uni=uni','delete from m1_survey_responses'])await deny(()=>h.rows(sql),/permission denied/);
  if(['a','b'].includes(role)){await save();await h.rpc('my_m1_survey',TERM);}else{await deny(()=>save());await deny(()=>h.rpc('my_m1_survey',TERM));}
  if(['teacher','grader'].includes(role))await h.rpc('m1_survey_class',TERM);else await deny(()=>h.rpc('m1_survey_class',TERM));
});
test('all required fields, text caps, grids, choices, Q9 and Q10 validate at the database boundary',async()=>{
  await h.as('a');await save(emptySurvey(),false);await deny(()=>save(emptySurvey()));
  for(const key of ['full_name','preferred_name','job','career_examples','ai_use','wish','setup_version','setup_haiku','program','sector','setup_assistant']){
    const v=surveyFixture();v.answers[key]='';await deny(()=>save(v));}
  for(const [key,cap] of Object.entries(TEXT_LIMITS)){const v=surveyFixture();v.answers[key]='x'.repeat(cap+1);await deny(()=>save(v,false));}
  const changes=[v=>v.answers.program='Unknown',v=>v.answers.sector='Unknown',v=>v.answers.setup_assistant='Unknown',v=>v.answers.extra='secret',
    v=>v.answers.ai_frequency.chatgpt='Often',v=>delete v.answers.experience.excel,v=>v.answers.experience.extra='Never',v=>v.answers.ai_frequency.other='Weekly',
    v=>v.q9=[],v=>v.q9=['augment','augment'],v=>v.q9=['wrong'],v=>v.q9=[1],v=>v.q10=null,v=>v.q10=-1,v=>v.q10=101,v=>v.q10='25',v=>delete v.q10];
  for(const change of changes){const v=surveyFixture();change(v);await deny(()=>save(v));}
  await deny(()=>save(surveyFixture(),null));const v=surveyFixture();v.answers.full_name='😀'.repeat(120);v.q10=0;await save(v);v.q10=100;await save(v);v.q10=50.5;await save(v);
  await h.as('owner');await deny(()=>h.rows("update m1_survey_responses set q10=101"),/constraint/);
});
test('Canvas individual deadline controls saves, never the grade-item or assignment base deadline',async()=>{
  await h.rows("update grade_items set due_at=clock_timestamp()+interval '3 days' where code='M1'");
  await h.rows("update canvas_assignments set due_at=clock_timestamp()+interval '3 days' where id=100");
  await h.rows("update canvas_submissions set cached_due_at=clock_timestamp()-interval '1 second' where user_id=1 and assignment_id=100");
  await h.as('a');for(const submit of [false,true])await deny(()=>save(surveyFixture(),submit),/closed/);
  await h.as('b');await save();
  await h.as('owner');await h.rows("update canvas_submissions set cached_due_at=null where user_id=1 and assignment_id=100");await h.as('a');await deny(()=>save(),/deadline/);
});
test('unhealthy syncs, unpublished assignments, hidden submissions and unmatched enrollment fail closed',async()=>{
  for(const sql of ["update canvas_sync_runs set status='failed'","update canvas_assignments set published=false where id=100", "update canvas_submissions set assignment_visible=false where user_id=1 and assignment_id=100", "update canvas_enrollments set match_status='unmatched',uni=null where user_id=1"]){
    await h.as('owner');await h.db.exec('savepoint snapshot');await h.rows(sql);await h.as('a');assert.equal((await h.rpc('my_m1_survey',TERM)).due_at,null);await deny(()=>save(),/deadline/);
    await h.as('owner');await h.db.exec('rollback to snapshot; release savepoint snapshot');}
});
test('a permitted test account without any roster row receives blank-name prefill instead of an error',async()=>{
  await h.rows('delete from roster');await h.rows("insert into private.test_accounts(email,role,uni) values('zz9999@columbia.edu','student','zz9999')");
  await h.as('outside');const own=await h.rpc('my_m1_survey',TERM);assert.equal(own.uni,'zz9999');assert.equal(own.roster_name,'');assert.equal(own.submission,null);assert.equal(own.read_only,false);assert.equal(own.due_at,null);
  await deny(()=>save(),/deadline/);
});
test('preview sees only the selected student and rejects RPC and owner-bypass trigger writes',async()=>{
  await h.as('a');await save();await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);
  assert.equal((await h.rpc('my_m1_survey',TERM)).submission.uni,'aa1001');assert.equal((await h.rpc('my_m1_survey',TERM)).read_only,true);
  await deny(()=>save(),/preview/);await deny(()=>h.rpc('m1_survey_class',TERM));
  await h.db.query('reset role');await deny(()=>h.rows("update m1_survey_responses set status='draft',submitted_at=null"),/preview/);
});
test('archives are read-only, cross-term student reads fail, and staff retain removed students',async()=>{
  await h.as('a');await save();await h.as('teacher');await h.rpc('open_term','Spring 2028');await h.as('a');
  assert.equal((await h.rpc('my_m1_survey',TERM)).read_only,true);await deny(()=>save());await deny(()=>h.rpc('my_m1_survey','spring-2028'));
  await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);await deny(()=>h.rpc('my_m1_survey','spring-2028'));await h.rpc('set_student_preview',null,TERM);
  await h.as('owner');await h.rows("delete from roster where uni='aa1001' and term_id=$1",[TERM]);await h.as('teacher');assert.equal((await h.rpc('m1_survey_class',TERM)).unrostered[0].uni,'aa1001');
});
test('RLS, empty SECURITY DEFINER search paths, preview protection and auditing are installed',async()=>{
  assert.equal((await h.rows("select relrowsecurity from pg_class where relname='m1_survey_responses'"))[0].relrowsecurity,true);
  const funcs=await h.rows("select proname,prosecdef,proconfig from pg_proc where proname in ('save_m1_survey','my_m1_survey','m1_survey_class')");assert.equal(funcs.length,3);assert.ok(funcs.every(f=>f.prosecdef&&f.proconfig.includes('search_path=""')));
  const triggers=await h.rows("select distinct trigger_name from information_schema.triggers where event_object_table='m1_survey_responses'");assert.deepEqual(triggers.map(t=>t.trigger_name).sort(),['change_audit','preview_guard']);
  await h.as('a');await deny(()=>h.rows("select private.survey_due($1)",[TERM]),/permission denied/);
});
