import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
let h,set;
beforeEach(async()=>{h=await phaseDatabase();await h.as('teacher');set=await h.rpc('create_group_set','Project groups',2,4,null);await h.rpc('save_student_note',TERM,'aa1001','PRIVATE-NOTE');});
afterEach(async()=>h?.db.close());

test('student notes are instructor-only, bounded, unaudited, and archived read-only',async()=>{
  await h.as('teacher');const first=await h.rpc('save_student_note',TERM,'aa1001','Revised note');
  assert.equal(first.body,'Revised note');assert.ok(first.updated_at);
  assert.equal((await h.rows('select body from student_notes'))[0].body,'Revised note');
  await assert.rejects(h.rpc('save_student_note',TERM,'aa1001','x'.repeat(10001)),/check constraint/);
  await assert.rejects(h.rpc('save_student_note',TERM,'zz9999','Unknown'),/Student not found/);
  await assert.rejects(h.rows("update student_notes set body='direct'"),/permission denied/);
  await h.as('owner');assert.deepEqual(await h.rows("select * from audit_log where table_name='student_notes'"),[]);
  assert.deepEqual((await h.rows("select tgname from pg_trigger where tgrelid='student_notes'::regclass and not tgisinternal")).map(r=>r.tgname),['preview_guard']);
  await h.as('teacher');await h.rpc('open_term','Fall 2027');
  assert.equal((await h.rows('select body from student_notes where term_id=$1',[TERM]))[0].body,'Revised note');
  await assert.rejects(h.rpc('save_student_note',TERM,'aa1001','Archived write'),/read-only/);
  assert.equal((await h.rpc('student_profile',TERM,'aa1001')).email,'aa1001@columbia.edu');
  await h.rpc('set_group_note',set,'New term note');
  assert.equal((await h.rpc('class_data',TERM)).sets[0].note,'');
  // Set IDs can recur across terms. The new term's matching set is writable, the archive is not.
});

for(const role of ['grader','a','auditor','outside','anon']) test(`${role} cannot read or write private student notes`,async()=>{
  await h.as(role);
  if(role==='anon')await assert.rejects(h.rows('select body from student_notes'),/permission denied/);
  else assert.deepEqual(await h.rows('select body from student_notes'),[]);
  await assert.rejects(h.rpc('save_student_note',TERM,'aa1001','Forbidden'));
  await assert.rejects(h.rows("insert into student_notes(term_id,uni,body) values($1,'aa1001','direct')",[TERM]));
  await assert.rejects(h.rpc('add_groups',set,1));await assert.rejects(h.rpc('set_group_note',set,'Forbidden'));
  if(role==='grader')assert.deepEqual(await h.rpc('student_profile',TERM,'aa1001'),{uni:'aa1001',name:'Alice',email:'aa1001@columbia.edu'});
  else await assert.rejects(h.rpc('student_profile',TERM,'aa1001'));
  await assert.rejects(h.rpc('calendar_data'),/permission denied/);
});

test('preview blocks profile access, note writes, group writes, and owner-bypass note writes',async()=>{
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  assert.deepEqual(await h.rows('select body from student_notes'),[]);
  for(const [name,args] of [['save_student_note',[TERM,'aa1001','Forbidden']],['student_profile',[TERM,'aa1001']],['set_group_note',[set,'Forbidden']],['add_groups',[set,2]]])await assert.rejects(h.rpc(name,...args));
  await h.db.query('reset role');
  for(const sql of ["update student_notes set body='Forbidden'",'delete from student_notes',"insert into student_notes(term_id,uni,body) values('spring-2027','bb1002','Forbidden')"])
    await assert.rejects(h.rows(sql),/preview.*read-only/i);
});

test('group note reaches student snapshot; additions are empty and numbered without changing members',async()=>{
  await h.as('teacher');await h.rpc('choose_group',set,(await h.rpc('class_data')).groups[0].id,'aa1001');
  await h.rpc('set_group_note',set,'Working alone? Join an empty group by yourself.');
  await h.rpc('add_groups',set,3);await h.rpc('add_groups',set,2);
  const d=await h.rpc('class_data');assert.deepEqual(d.groups.map(g=>g.number).sort((a,b)=>a-b),[1,2,3,4,5,6,7]);assert.equal(d.members.length,1);
  await h.as('a');assert.equal((await h.rpc('class_data')).sets[0].note,'Working alone? Join an empty group by yourself.');
  await h.as('teacher');for(const count of [0,-1,101,null])await assert.rejects(h.rpc('add_groups',set,count),/between 1 and 100/);
  for(const note of ['two\nlines','two\rlines','x'.repeat(501)])await assert.rejects(h.rpc('set_group_note',set,note),/check constraint/);
});

test('calendar projection is service-only, active-only, and contains no private fields',async()=>{
  await h.as('teacher');for(let week=1;week<=6;week++)await h.rpc('set_session_times',week,`2027-02-0${week}T14:00:00Z`,`2027-02-0${week}T17:00:00Z`);
  await h.rpc('configure_grade_item',2,'file','individual',null,'2027-02-03T14:00:00Z');
  await assert.rejects(h.rpc('calendar_data'),/permission denied/);
  await h.as('service');const data=await h.rpc('calendar_data');
  assert.equal(data.term_id,TERM);assert.equal(data.sessions.length,6);assert.equal(data.items.length,1);
  assert.deepEqual(Object.keys(data).sort(),['items','sessions','term_id']);
  assert.deepEqual(Object.keys(data.sessions[0]).sort(),['ends_at','starts_at','week']);
  assert.deepEqual(Object.keys(data.items[0]).sort(),['code','due_at','id','title']);
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE-NOTE|aa1001|Alice|roster|instruction|description/);
  await h.as('teacher');await h.rpc('open_term','Fall 2027');await h.as('service');
  const next=await h.rpc('calendar_data');assert.equal(next.term_id,'fall-2027');assert.equal(next.items.length,0);assert.ok(next.sessions.every(s=>!s.starts_at));
});
