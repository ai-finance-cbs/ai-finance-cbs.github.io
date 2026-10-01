import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
let h;
before(async()=>{h=await phaseDatabase();});after(async()=>h?.db.close());
test('release and auditor predicates match raw metadata and SECURITY DEFINER projections',async()=>{
  await h.as('teacher');
  for(const [title,visible,released,date] of [['past',true,false,'2000-01-01'],['future',true,false,'2100-01-01'],['click',true,true,'2100-01-01'],['private',false,true,null]])
    await h.rows('insert into lecture_files(week,title,storage_path,auditor_visible,released,release_at) values(1,$1,$2,$3,$4,$5)',[title,`${title}.pdf`,visible,released,date]);
  for(const [who,names] of [['a',['click','past','private']],['auditor',['click','past']]]){
    await h.as(who);
    assert.deepEqual((await h.rows('select title from lecture_files order by title')).map(x=>x.title),names);
    assert.deepEqual((await h.rpc('class_data')).files.map(x=>x.title).sort(),names);
    if(who==='auditor')for(const key of ['grades','attendance','items','sets','groups','members','submissions'])assert.deepEqual((await h.rpc('class_data'))[key],[]);
  }
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  assert.deepEqual((await h.rpc('view_as_student','aa1001')).files.map(x=>x.title).sort(),['click','past','private']);
  assert.deepEqual(await h.rows('update lecture_files set released=true,release_at=now() returning id'),[]);
  await assert.rejects(h.rpc('set_session_times',1,'2027-01-18T14:00Z','2027-01-18T17:00Z'),/read-only/);
  await assert.rejects(h.rows("update attendance_sessions set starts_at=now()"),/permission denied/);
  await h.rpc('set_student_preview',null);
});
test('week 0 and 7 are valid, week 8 is invalid, and session times preserve the date',async()=>{
  await h.as('owner');await h.db.exec('insert into attendance_sessions(week) values(0),(7)');
  await assert.rejects(h.rows('insert into attendance_sessions(week) values(8)'),/check constraint/);
  await h.as('teacher');
  for(const week of [0,7])await h.rows('insert into lecture_files(week,title,storage_path) values($1,$2,$3)',[week,`Week ${week}`,`week-${week}.pdf`]);
  await assert.rejects(h.rows("insert into lecture_files(week,title,storage_path) values(8,'bad','bad.pdf')"),/check constraint/);
  await h.rpc('set_session_times',1,'2027-03-15T13:00:00Z','2027-03-15T16:00:00Z');
  const s=(await h.rpc('class_data')).sessions.find(s=>s.week===1);
  assert.equal(s.date,'2027-03-15'); assert.ok(s.starts_at);assert.ok(s.ends_at);
  await assert.rejects(h.rpc('set_session_times',1,'2027-03-15T16:00Z','2027-03-15T13:00Z'),/check constraint/);
});
test('term keys permit repeated week/code/UNI and keep a current student out of another term',async()=>{
  await h.as('owner');await h.db.exec("insert into terms(id,title,status) values('spring-2028','Spring 2028','closed'); insert into attendance_sessions(term_id,week) values('spring-2028',1); insert into roster(term_id,uni,name) values('spring-2028','aa1001','Alice next year'); insert into grade_items(term_id,code,title,max_points,quiz_week) values('spring-2028','Q1','Next quiz',3,1); insert into lecture_files(term_id,week,title,storage_path,released) values('spring-2028',1,'Next year','next.pdf',true)");
  const ids=await h.rows("select id from grade_items where code='Q1' order by id");assert.equal(ids.length,2);assert.notEqual(ids[0].id,ids[1].id);
  await h.as('a');assert.equal((await h.rows('select id from terms')).length,1);
  await assert.rejects(h.rpc('class_data','spring-2028'),/Class access/);
  assert.ok((await h.rows('select title from lecture_files')).every(f=>f.title!=='Next year'));
  await h.as('grader');assert.equal((await h.rpc('class_data','spring-2028')).files[0].title,'Next year');
});
test('archived students retain only their old term after active roster replacement and cannot write',async()=>{
  await h.as('teacher');await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:8,comment:'Old comment'}]));await h.rpc('release_grade_item',1,true);
  await h.as('owner');await h.db.exec("update terms set status='archived-readable' where id='spring-2027'; update terms set status='active' where id='spring-2028'");
  await h.as('teacher');await h.rpc('replace_roster',JSON.stringify([{uni:'bb1002',name:'Bob next year'}]));
  assert.equal((await h.rows('select uni from roster where term_id=$1',[TERM])).length,4);
  await h.as('a');const a=await h.rpc('get_access');assert.equal(a.role,'student');assert.equal(a.term_id,TERM);assert.equal(a.read_only,true);
  const data=await h.rpc('class_data');assert.equal(data.grades[0].comment,'Old comment');assert.equal(data.grades[0].score,8);
  for(const [name,args] of [['begin_submission',[1,'a.pdf',10,'application/pdf']],['submit_link',[6,'https://example.test/video']],['finish_submission',['00000000-0000-0000-0000-000000000001']],['choose_group',['00000000-0000-0000-0000-000000000001']]])await assert.rejects(h.rpc(name,...args),/read-only/);
  await assert.rejects(h.rpc('class_data','spring-2028'),/Class access/);
  await h.as('b');assert.equal((await h.rpc('get_access')).term_id,'spring-2028');assert.deepEqual((await h.rpc('class_data')).grades,[]);
  await h.as('owner');await h.rows("update terms set status='closed' where id=$1",[TERM]);
  await h.as('a');assert.equal((await h.rpc('get_access')).role,'unlisted');await assert.rejects(h.rpc('class_data',TERM),/Class access/);
});
