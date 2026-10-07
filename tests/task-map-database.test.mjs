import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {emptyTaskMap} from '../assets/materials/task-map-core.js';
import {taskMapFixture} from './fixtures/task-map.mjs';
let h;
before(async()=>{h=await phaseDatabase();}); after(async()=>h?.db.close());
beforeEach(async()=>{await h.as('owner');await h.db.exec("begin; update grade_items set due_at=clock_timestamp()+interval '1 day' where code='M2'");});
afterEach(async()=>{await h.db.exec('rollback; reset role');});
async function deny(fn,pattern=/permission denied|access required|preview|read-only|closed|deadline|Invalid task map|constraint|active term/i) {
  await h.db.exec('savepoint denied'); try {await assert.rejects(fn,pattern);} finally {await h.db.exec('rollback to denied; release savepoint denied');}
}
const save=(value=taskMapFixture(),submit=true,term=TERM)=>h.rpc('save_task_map',term,JSON.stringify(value),submit);
test('student saves only their session identity, reloads, resubmits, and audits each change',async()=>{
  await h.as('a'); const value=emptyTaskMap(); value.uni='bb1002'; value.term_id='other'; value.status='submitted';
  const draft=await save(value,false); assert.equal(draft.uni,'aa1001'); assert.equal(draft.term_id,TERM); assert.equal(draft.status,'draft');
  assert.equal((await h.rpc('my_task_map',TERM)).submission.uni,'aa1001');
  const first=await save(),second=await save(); assert.notEqual(second.submitted_at,first.submitted_at);
  assert.equal(second.status,'submitted');
  await h.as('b'); assert.equal((await h.rpc('my_task_map',TERM)).submission,null);
  await h.as('teacher'); const staff=await h.rpc('task_map_class',TERM); assert.equal(staff.students.length,4);
  assert.equal(staff.students.filter(r=>r.submission).length,1);
  const audits=await h.rows("select * from audit_log where table_name='task_map_submissions'"); assert.equal(audits.length,3);
  assert.ok(audits.every(r=>r.actor_email==='aa1001@columbia.edu'));
  await h.as('a'); const replaced=await save(emptyTaskMap(),false); assert.equal(replaced.submitted_at,null); assert.equal(replaced.status,'draft');
});
for(const who of ['a','b','teacher','grader','auditor','outside','anon'])test(`${who}: raw table denied; RPC role boundaries hold`,async()=>{
  await h.as(who);
  for(const sql of ['select * from task_map_submissions','insert into task_map_submissions default values','update task_map_submissions set uni=uni','delete from task_map_submissions'])await deny(()=>h.rows(sql),/permission denied/);
  if(['a','b'].includes(who)){await save(); await h.rpc('my_task_map',TERM);}else {await deny(()=>save());await deny(()=>h.rpc('my_task_map',TERM));}
  if(['teacher','grader'].includes(who))assert.equal((await h.rpc('task_map_class',TERM)).students.length,4);
  else await deny(()=>h.rpc('task_map_class',TERM));
});
test('database validates completeness, types, all text caps, labels, and maximum task count',async()=>{
  await h.as('a'); await save(emptyTaskMap(),false); await deny(()=>save(emptyTaskMap(),true));
  const cases=[v=>v.tasks.pop(),v=>v.tasks.push(...Array(5).fill(v.tasks[0])),v=>v.tasks[0].label='P',v=>v.tasks[0].label=42,
    v=>delete v.tasks[0].label,v=>v.tasks[0].name='x'.repeat(81),v=>v.tasks[0].description='x'.repeat(401),
    v=>v.look_ahead.name='x'.repeat(81),v=>v.look_ahead.description='x'.repeat(401),v=>v.look_ahead.reasoning='x'.repeat(2001),
    v=>v.ai_use='x'.repeat(601),v=>v.job.role='x'.repeat(121),v=>v.job.firm_type='x'.repeat(121),v=>v.job.duration='x'.repeat(121),
    v=>v.tasks[0].name=' \n',v=>v.look_ahead.label=null,v=>v.look_ahead.reasoning='\n\t',v=>v.ai_use='\n\t',v=>v.ai_use=12,
    v=>v.job=[],v=>v.tasks=[null],v=>v.look_ahead=null,v=>v.tasks[0].reasoning='Extra',v=>v.job.other='extra'];
  for(const change of cases){const value=taskMapFixture();change(value);await deny(()=>save(value));}
  await deny(()=>save(taskMapFixture(),null));
  const max=taskMapFixture(); max.tasks[0].name='😀'.repeat(80); max.tasks.push(...max.tasks.slice(0,4)); await save(max);
  await h.as('owner'); await deny(()=>h.rows("update task_map_submissions set tasks='[]'"),/constraint/);
});
test('deadline enforcement uses the database clock for both draft and submit, and missing deadlines fail closed',async()=>{
  await h.as('a'); const before=await save(); await h.as('owner');
  await h.rows("update grade_items set due_at=clock_timestamp()-interval '1 second' where code='M2'");
  await h.as('a'); for(const submit of [false,true])await deny(()=>save(taskMapFixture(),submit),/closed/);
  assert.deepEqual((await h.rpc('my_task_map',TERM)).submission,before);
  await h.as('owner'); await h.rows("update grade_items set due_at=null where code='M2'"); await h.as('a'); await deny(()=>save(),/deadline/);
});
test('preview reads only the selected student and blocks both RPC and trigger writes',async()=>{
  await h.as('a'); await save(); await h.as('teacher'); await h.rpc('set_student_preview','aa1001',TERM);
  const preview=await h.rpc('my_task_map',TERM); assert.equal(preview.submission.uni,'aa1001'); assert.equal(preview.read_only,true);
  await deny(()=>save(),/preview/i); await deny(()=>h.rpc('task_map_class',TERM));
  await h.db.query('reset role'); await deny(()=>h.rows("update task_map_submissions set ai_use='forged'"),/preview/i);
});
test('archives retain own and staff reads, deny writes and cross-term access, and preserve unrostered work for staff',async()=>{
  await h.as('a'); await save(); await h.as('teacher'); await h.rpc('open_term','Spring 2028');
  await h.as('a'); assert.equal((await h.rpc('my_task_map',TERM)).read_only,true); await deny(()=>save());
  await deny(()=>h.rpc('my_task_map','spring-2028')); await deny(()=>save(taskMapFixture(),true,'spring-2028'));
  await h.as('teacher'); assert.equal((await h.rpc('task_map_class',TERM)).students.filter(s=>s.submission).length,1);
  await h.rpc('set_student_preview','aa1001',TERM); await deny(()=>h.rpc('my_task_map','spring-2028'));
  await h.rpc('set_student_preview',null,TERM); await h.as('owner'); await h.rows("delete from roster where uni='aa1001' and term_id=$1",[TERM]);
  await h.as('teacher'); assert.equal((await h.rpc('task_map_class',TERM)).unrostered[0].uni,'aa1001');
});
test('RLS, fixed SECURITY DEFINER paths, and both required triggers are installed',async()=>{
  assert.equal((await h.rows("select relrowsecurity from pg_class where relname='task_map_submissions'"))[0].relrowsecurity,true);
  const funcs=await h.rows("select proname,prosecdef,proconfig from pg_proc where proname in ('save_task_map','my_task_map','task_map_class')");
  assert.equal(funcs.length,3); assert.ok(funcs.every(f=>f.prosecdef&&f.proconfig.includes('search_path=""')));
  const triggers=await h.rows("select distinct trigger_name from information_schema.triggers where event_object_table='task_map_submissions'");
  assert.deepEqual(triggers.map(t=>t.trigger_name).sort(),['change_audit','preview_guard']);
});
