import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {canvasFixture} from './fixtures/canvas.mjs';
import {canvasStatus} from '../assets/materials/canvas-core.js';
let h,archive,group,pending;
const migration=readFileSync(new URL('../supabase/migrations/019_canvas_student_views.sql',import.meta.url),'utf8');
before(async()=>{
  // Create a real pre-cutover archive, then apply the migration without deleting it.
  h=await phaseDatabase(undefined,'018_canvas_mirror.sql');
  pending=await h.begin();archive=await h.finish(pending);
  await h.as('teacher');group=await h.rpc('create_group_set','Archive groups',2,4,null);
  await h.as('owner');await h.db.exec(migration);
});
after(async()=>h?.db.close());
beforeEach(async()=>{await h.as('owner');await h.db.exec('begin');});
afterEach(async()=>{await h.db.exec('rollback; reset role');});
async function deny(fn,pattern=/permission denied|Student access|row-level security/){
  await h.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await h.db.exec('rollback to denied; release savepoint denied');}
}
async function seed(change=()=>{}) {
  const raw=canvasFixture();change(raw);
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);const run=await h.rpc('request_canvas_sync',TERM);
  await h.as('service');await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));
  await h.as('teacher');
  for(const [key,id,kind,week] of [['M1',100,'milestone',1],['M2',101,'milestone',2],['Q6',102,'quiz',6],['O1',103,'optional',null]])await h.rpc('save_canvas_mapping',TERM,key,id,kind,week);
  return run;
}
const read=async(who='a',term=TERM)=>{await h.as(who);return h.rpc('canvas_student_data',term);};

test('own-only projection exposes posted zero, hides unposted scores, and shows only teammate names',async()=>{
  await seed(raw=>{
    raw.submissions.find(s=>s.user_id===1&&s.assignment_id===100).score=0;
    Object.assign(raw.submissions.find(s=>s.user_id===1&&s.assignment_id===101),{score:9876,grade:'HIDDEN',posted_at:null});
    raw.submissions.filter(s=>s.user_id===2).forEach(s=>{s.score=4321;s.grade='OTHER STUDENT';});
    raw.groups.push({id:81,category_id:7,category_name:'Project',name:'Other group'}, {id:82,category_id:8,category_name:'Discussion',name:'Team Two'});
    raw.group_members.push({id:3,group_id:81,name:'PRIVATE OTHER NAME'},{id:1,group_id:82,name:'Canvas student 1'});
  });
  const d=await read();assert.equal(d.available,true);assert.equal(d.items.length,4);
  assert.equal(d.items[0].score,0);assert.equal(d.items[0].posted_visible,true);
  const hidden=d.items.find(i=>i.site_key==='M2');assert.equal(hidden.status,'Done');assert.equal(hidden.score,null);assert.equal(hidden.grade,null);assert.equal(hidden.posted_visible,false);
  assert.equal(d.items[0].url,'https://courseworks2.columbia.edu/courses/240315/assignments/100');
  assert.equal(d.groups.length,2);assert.deepEqual(d.groups[0].members,[{name:'Canvas student 1'},{name:'Canvas student 2'}]);
  const text=JSON.stringify(d);for(const secret of ['9876','HIDDEN','4321','OTHER STUDENT','PRIVATE OTHER NAME','actor_email','aa1001','bb1002','login_id','user_id','comment'])assert.ok(!text.includes(secret),secret);
  const other=await read('b');assert.equal(other.items[0].score,4321);assert.equal(other.groups.length,1);
  const third=await read('c');assert.equal(third.groups[0].name,'Other group');assert.ok(!JSON.stringify(third).includes('Canvas student 2'));
});
for(const who of ['teacher','grader','auditor','outside','anon'])test(`${who} cannot call the student projection`,async()=>{
  await seed();await h.as(who);await deny(()=>h.rpc('canvas_student_data',TERM));
  if(['teacher','grader'].includes(who))assert.equal((await h.rpc('canvas_staff_data',TERM)).submissions.length,78);
});
test('preview uses the selected identity, keeps grades posted-only, and cannot select a different readable term',async()=>{
  await seed(raw=>{raw.submissions.filter(s=>s.user_id===2).forEach(s=>{s.score=7;s.grade='7';});});
  const bob=await read('b');await h.as('teacher');await h.rpc('set_student_preview','bb1002',TERM);
  assert.deepEqual(await h.rpc('canvas_student_data'),bob);
  await deny(()=>h.rpc('canvas_student_data','another-term'));
  await h.rpc('set_student_preview','aa1001',TERM);assert.equal((await h.rpc('canvas_student_data')).items[0].score,0);
  await deny(()=>h.rpc('save_canvas_mapping',TERM,'M1',100,'milestone',1),/Instructor|preview/);
});
test('unmatched, ambiguous, inactive, removed, and newly unrostered enrollments never receive personal data',async()=>{
  await seed();
  for(const change of ["uni=null,match_status='unmatched'","uni=null,match_status='ambiguous'","enrollment_states=array['inactive']","enrollment_states=array['completed']"]) {
    await h.as('owner');await h.rows(`update canvas_enrollments set ${change} where user_id=1`);
    const d=await read();assert.equal(d.available,false);assert.deepEqual(d.groups,[]);assert.ok(d.items.every(i=>i.status==='Status unavailable'&&i.score===null&&i.url===null));
    await h.as('owner');await h.rows("update canvas_enrollments set uni='aa1001',match_status='matched',enrollment_states=array['active'] where user_id=1");
  }
  await h.as('owner');await h.rows("delete from roster where uni='aa1001'");await h.as('a');await deny(()=>h.rpc('canvas_student_data',TERM));
});
test('archive reads are scoped, closed terms deny students, and preview cannot escape its pinned term',async()=>{
  await seed();await h.as('teacher');await h.rpc('open_term','Spring 2028');
  assert.equal((await read()).available,true);
  await h.as('owner');await h.rows("update canvas_enrollments set enrollment_states=array['completed'] where user_id=1");assert.equal((await read()).available,true);
  await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);await deny(()=>h.rpc('canvas_student_data','spring-2028'));
  await h.as('owner');await h.rows("update terms set status='closed' where id=$1",[TERM]);await h.as('a');await deny(()=>h.rpc('canvas_student_data',TERM));
});
test('failure masks every judgment and grade; a successful replacement restores data and posting withdrawal hides scores',async()=>{
  await seed();await h.as('teacher');const failed=await h.rpc('request_canvas_sync',TERM);
  await h.as('service');await h.rpc('fail_canvas_sync',failed.id,'auth_failed','PRIVATE ERROR');
  const d=await read();assert.equal(d.available,false);assert.ok(d.last_synced_at);assert.deepEqual(d.groups,[]);
  assert.ok(d.items.every(i=>i.status==='Status unavailable'&&i.score===null&&i.due_at===null));assert.ok(!JSON.stringify(d).includes('PRIVATE ERROR'));
  await h.as('teacher');const run=await h.rpc('request_canvas_sync',TERM);assert.equal((await read()).available,false);
  const raw=canvasFixture();raw.submissions[0].posted_at=null;await h.as('service');await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));
  const fresh=await read();assert.equal(fresh.available,true);assert.equal(fresh.items[0].posted_visible,false);assert.equal(fresh.items[0].score,null);
  await h.as('teacher');const stale=await h.rpc('request_canvas_sync',TERM);await h.as('owner');await h.rows("update canvas_sync_runs set started_at=now()-interval '11 minutes' where id=$1",[stale.id]);assert.equal((await read()).available,false);
});
test('no snapshot, no submission, invisible or unpublished assignment is unavailable, and personal overrides win',async()=>{
  let d=await read();assert.equal(d.available,false);assert.deepEqual(d.items,[]);
  await seed(raw=>{
    raw.assignments[0].overrides=[{student_ids:[1],due_at:'2027-04-01T14:00:00Z'}];
    raw.submissions.find(s=>s.assignment_id===101&&s.user_id===1).assignment_visible=false;
    raw.assignments[2].published=false;
    raw.submissions=raw.submissions.filter(s=>!(s.assignment_id===103&&s.user_id===1));
  });
  d=await read();assert.equal(Date.parse(d.items.find(i=>i.site_key==='M1').due_at),Date.parse('2027-04-01T14:00:00Z'));
  for(const key of ['M2','Q6','O1']){const i=d.items.find(i=>i.site_key===key);assert.equal(i.status,'Status unavailable');assert.equal(i.score,null);assert.equal(i.url,null);}
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240316,true);d=await read();assert.equal(d.available,false);assert.deepEqual(d.items,[]);
});
test('SQL and demo status precedence agree at exact due times and for optional and missing-policy work',async()=>{
  const at='2027-03-01T14:00:00Z',base={assignment_visible:true,workflow_state:'unsubmitted',cached_due_at:at,excused:false,missing:false,late:false,late_policy_status:null};
  const cases=[
    [{excused:true,missing:true,late:true},'milestone','Excused'],[{missing:true,late:true,workflow_state:'graded'},'milestone','Missing'],
    [{late_policy_status:'missing',workflow_state:'graded',score:0},'quiz','Missing'],[{late:true,workflow_state:'submitted'},'milestone','Late'],
    [{workflow_state:'submitted'},'milestone','Done'],[{workflow_state:'pending_review'},'milestone','Done'],[{workflow_state:'graded'},'milestone','Done'],
    [{cached_due_at:'2027-03-02T14:00:00Z'},'milestone','Not yet due'],[{},'milestone','Missing'],[{cached_due_at:null},'milestone','No due date'],
    [{missing:true},'optional','Optional'],[{missing:true,workflow_state:'graded'},'optional','Optional'],[{missing:true,workflow_state:'graded',submitted_at:'2027-02-28T14:00:00Z'},'optional','Done'],[{late:true,workflow_state:'submitted'},'optional','Late'],
    [{assignment_visible:false},'milestone','Status unavailable'],[null,'milestone','Status unavailable'],
  ];
  await h.as('owner');for(const [changes,kind,expected] of cases){const s=changes===null?null:{...base,...changes};
    assert.equal((await h.rows('select private.canvas_student_status($1,$2,$3) s',[s?JSON.stringify(s):null,kind,at]))[0].s,expected);
    assert.equal(canvasStatus(s,{kind},Date.parse(at)),expected);
  }
});
const deniedCalls=[['begin_submission',1,'new.pdf',10,'application/pdf'],['finish_submission','11111111-0000-0000-0000-000000000001',null],['submit_link',6,'https://example.test'],['delete_submission','11111111-0000-0000-0000-000000000001'],['create_group_set','Bad',2,4,null],['update_group_set',null,true,null],['choose_group',null,null,null],['set_group_note',null,'bad'],['add_groups',null,1],['confirm_submission_upload',TERM,null,10,'application/pdf']];
for(const who of ['teacher','grader','a','auditor','outside','anon','preview','service'])test(`${who} cannot use retired write RPCs; archive rows remain intact`,async()=>{
  if(who==='preview'){await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);}else await h.as(who);
  for(const [name,...args] of deniedCalls)await deny(()=>h.rpc(name,...args),/permission denied/);
  if(who!=='service')await deny(()=>h.rows("insert into storage.objects(bucket_id,name) values('submissions','forged.pdf')"),/row-level security/);
  await h.as('owner');assert.equal((await h.rows('select id from submissions')).length,1);assert.equal((await h.rows('select id from group_sets where id=$1',[group])).length,1);
});
test('staff archives remain readable after submission and group retirement',async()=>{
  for(const who of ['teacher','grader']){await h.as(who);assert.equal((await h.rows('select id,storage_path,on_time_path,file_name from submissions')).length,1);assert.equal((await h.rpc('class_data',TERM)).submissions.length,1);}

});
test('new functions use fixed search paths, deny raw student mirror reads, and accept no identity argument',async()=>{
  await seed();await h.as('owner');
  const defs=await h.rows("select proname,prosecdef,proconfig,proargnames from pg_proc where proname in ('canvas_student_data','canvas_student_status')");
  assert.equal(defs.length,2);assert.ok(defs.every(f=>f.prosecdef&&f.proconfig.includes('search_path=""')));assert.deepEqual(defs.find(f=>f.proname==='canvas_student_data').proargnames,['p_term']);
  for(const who of ['a','auditor','outside','preview']){
    if(who==='preview'){await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);}else await h.as(who);
    for(const table of ['canvas_courses','canvas_enrollments','canvas_assignments','canvas_submissions','canvas_groups','canvas_group_members','canvas_assignment_map'])assert.deepEqual(await h.rows(`select * from ${table}`),[]);
    await deny(()=>h.rows('select * from canvas_sync_runs'),/permission denied/);
    await deny(()=>h.rows("select private.canvas_student_status(null,'quiz',now())"),/permission denied/);
  }
});
