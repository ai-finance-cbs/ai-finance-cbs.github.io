import {test,before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {canvasFixture} from './fixtures/canvas.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
let h;
before(async()=>{
  h=await phaseDatabase();const raw=canvasFixture();raw.assignments.forEach(a=>a.due_at=new Date(Date.now()+86400000).toISOString());
  raw.groups.push({id:81,category_id:7,category_name:'Project',name:'Group 2'},{id:82,category_id:8,category_name:'Other',name:'Wrong category'});
  raw.group_members.push({id:3,group_id:81,name:'Canvas student 3'},{id:4,group_id:82,name:'Canvas student 4'});
  await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);const run=await h.rpc('request_canvas_sync',TERM);
  await h.as('service');await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));
  await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M3',100,'milestone',3);
});
after(async()=>h?.db.close());beforeEach(async()=>{await h.as('owner');await h.db.exec('begin');});afterEach(async()=>{await h.db.exec('rollback; reset role');});
const mine=(term=TERM,code='M3')=>h.rpc('my_group_link',term,code);
const save=(link='https://team.github.io/',term=TERM,code='M3')=>h.rpc('save_group_link',term,code,link);
const staff=()=>h.rpc('group_link_class',TERM,'M3');
async function deny(fn,pattern=/permission denied|access required|preview|active term|read-only|closed|deadline|Invalid|constraint|https|not set up|Join your group|unavailable/i){
  await h.db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await h.db.exec('rollback to denied; release savepoint denied');}
}
test('two members share one row; the last member replaces it; other groups remain separate and audit records identify callers',async()=>{
  await h.as('a');const first=await save();assert.equal(first.submitted_by_uni,'aa1001');assert.equal(first.canvas_group_id,80);
  const own=await mine();assert.equal(own.group.name,'Group 1');assert.equal(own.group.members.length,2);assert.deepEqual(own.submission,first);
  await h.as('b');assert.deepEqual((await mine()).submission,first);const second=await save('https://custom.example.test');assert.equal(second.submitted_by_name,'Bob');assert.notEqual(second.updated_at,first.updated_at);
  await h.as('a');assert.deepEqual((await mine()).submission,second);
  await h.as('c');assert.equal((await mine()).submission,null);const other=await save('https://other.example.test');assert.equal(other.canvas_group_id,81);
  await h.as('b');assert.equal((await mine()).submission.link,second.link);
  await h.as('teacher');const rows=(await staff()).groups;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.submission));assert.ok(rows.every(r=>r.late===false));
  const audit=await h.rows("select actor_email from audit_log where table_name='group_link_submissions'");assert.deepEqual(audit.map(r=>r.actor_email),['aa1001@columbia.edu','bb1002@columbia.edu','cc1003@columbia.edu']);
});
test('staff table includes missing groups and flags late rows against effective deadlines',async()=>{
  await h.as('a');await save();await h.as('owner');await h.rows("update canvas_submissions set cached_due_at=clock_timestamp()-interval '1 day' where user_id=1 and assignment_id=100");
  await h.as('grader');const result=await staff();assert.equal(result.groups[0].late,true);assert.equal(result.groups[1].submission,null);
});
for(const role of ['a','b','c','d','teacher','grader','auditor','outside','anon'])test(`${role}: raw grants and role-based RPC denials`,async()=>{
  await h.as(role);
  for(const sql of ['select * from group_link_submissions','insert into group_link_submissions default values','update group_link_submissions set link=link','delete from group_link_submissions'])await deny(()=>h.rows(sql),/permission denied/);
  if(['a','b','c'].includes(role)){await mine();await save();}else if(role==='d'){assert.equal((await mine()).group,null);await deny(()=>save(),/Join your group/);}else{await deny(()=>mine());await deny(()=>save());}
  if(['teacher','grader'].includes(role))await staff();else await deny(()=>staff());
});
test('RLS also isolates groups if a raw SELECT grant is accidentally restored',async()=>{
  await h.as('a');await save();await h.as('c');await save();await h.as('owner');await h.rows('grant select on group_link_submissions to authenticated');
  for(const [role,expected] of [['a',[80]],['b',[80]],['c',[81]],['d',[]],['teacher',[80,81]],['grader',[80,81]],['auditor',[]],['outside',[]]]){
    await h.as(role);assert.deepEqual((await h.rows('select canvas_group_id from group_link_submissions order by canvas_group_id')).map(r=>r.canvas_group_id),expected);
  }
});
test('membership is derived from the M3 category, rejects ambiguity, and a group change never carries the link',async()=>{
  await h.as('d');assert.equal((await mine()).group,null);await deny(()=>save(),/Join your group/);
  await h.as('a');await save();await h.as('owner');await h.rows('update canvas_group_members set group_id=81 where group_id=80 and user_id=1');
  await h.as('a');assert.equal((await mine()).group.id,81);assert.equal((await mine()).submission,null);await save('https://new.example.test');
  await h.as('b');assert.equal((await mine()).submission.link,'https://team.github.io/');
  await h.as('owner');await h.rows("insert into canvas_group_members values($1,80,1,'Synthetic duplicate')",[TERM]);
  await h.as('a');assert.equal((await mine()).group,null);await deny(()=>save(),/Join your group/);
});
test('missing mapping or category refuses the form, without any local-group fallback',async()=>{
  for(const sql of ["delete from canvas_assignment_map where site_key='M3'","update canvas_assignments set group_category_id=null where id=100"]){
    await h.as('owner');await h.db.exec('savepoint setting');await h.rows(sql);await h.as('a');assert.equal((await mine()).setup,false);await deny(()=>save(),/not set up/);
    await h.as('teacher');assert.deepEqual((await staff()).groups,[]);await h.as('owner');await h.db.exec('rollback to setting; release savepoint setting');
  }
});
test('individual Canvas deadlines lock saves at the boundary and unavailable data fails closed',async()=>{
  await h.as('a');await save();await h.as('owner');await h.rows("update grade_items set due_at=clock_timestamp()+interval '3 days' where code='M3'");
  await h.rows("update canvas_submissions set cached_due_at=clock_timestamp()-interval '1 second' where user_id=1 and assignment_id=100");
  await h.as('a');assert.equal((await mine()).closed,true);assert.ok((await mine()).submission);await deny(()=>save(),/closed/);
  await h.as('b');await save();
  for(const sql of ["update canvas_submissions set cached_due_at=null where assignment_id=100", "update canvas_assignments set published=false where id=100", "update canvas_submissions set assignment_visible=false where assignment_id=100", "update canvas_sync_runs set status='failed'", "update canvas_enrollments set match_status='unmatched',uni=null where user_id=1"]){
    await h.as('owner');await h.db.exec('savepoint setting');await h.rows(sql);await h.as('a');assert.equal((await mine()).due_at,null);await deny(()=>save(),/deadline|unavailable/);
    await h.as('owner');await h.db.exec('rollback to setting; release savepoint setting');
  }
});
test('preview is read-only in both RPC and trigger; archives and cross-term requests are guarded',async()=>{
  await h.as('a');await save();await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);assert.equal((await mine()).read_only,true);assert.ok((await mine()).submission);
  await deny(()=>save(),/preview/);await deny(()=>staff());await h.db.query('reset role');await deny(()=>h.rows('update group_link_submissions set link=link'),/preview/);
  await h.as('teacher');await h.rpc('set_student_preview',null,TERM);await h.rpc('open_term','Spring 2028');await h.as('a');assert.equal((await mine()).read_only,true);await deny(()=>save());await deny(()=>mine('spring-2028'));
  await h.as('teacher');await h.rpc('set_student_preview','aa1001',TERM);await deny(()=>mine('spring-2028'));
});
test('database boundary validates links and code; RPCs use empty SECURITY DEFINER search paths',async()=>{
  await h.as('a');for(const link of [null,'','http://example.test','javascript:alert(1)','https://','https:///bad','https://a.test/space here','https://a.test\\@b.test','https://example.test/'+ 'x'.repeat(2000)])await deny(()=>save(link),/https/);
  const exact='https://example.test/'+ 'a'.repeat(1979);await save(exact);await save('https://custom.test/?hello=world#here');
  for(const code of [null,'FP','M2']){await deny(()=>mine(TERM,code));await deny(()=>save('https://example.test',TERM,code));}
  await h.as('owner');assert.equal((await h.rows("select relrowsecurity from pg_class where relname='group_link_submissions'"))[0].relrowsecurity,true);
  const funcs=await h.rows("select prosecdef,proconfig from pg_proc where proname in ('my_group_link','save_group_link','group_link_class','group_link_context')");assert.equal(funcs.length,4);assert.ok(funcs.every(f=>f.prosecdef && f.proconfig.includes('search_path=""')));
  await deny(()=>h.rows("update group_link_submissions set code='FP'"),/constraint/);
});
