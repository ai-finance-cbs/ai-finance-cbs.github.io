import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
let h;
beforeEach(async()=>{
  h=await phaseDatabase();await h.as('owner');
  await h.rows("insert into assignments(id,title,due,points,description,deliverable,grading,auditor_visible) values(1,'Survey','Week 1',10,'Summary','Work','Criteria',true),(2,'Map','Week 2',10,'Private summary','Work','Criteria',false)");
  await h.as('teacher');for(const code of ['M1','M2','O1'])await h.rpc('save_assignment_page',TERM,code,`Private instructions ${code}`);
});
afterEach(async()=>h?.db.close());
test('instructor saves bounded term-scoped Markdown with an audit and no direct browser writes',async()=>{
  const row=await h.rpc('save_assignment_page',TERM,'M1','# Updated');assert.equal(row.body_md,'# Updated');assert.ok(row.updated_at);
  assert.equal((await h.rows('select body_md from assignment_pages where code=\'M1\''))[0].body_md,'# Updated');
  for(const code of ['M6','O5','PA','Q1'])await assert.rejects(h.rpc('save_assignment_page',TERM,code,'bad'),/check constraint/);
  await assert.rejects(h.rpc('save_assignment_page',TERM,'M1','x'.repeat(50001)),/check constraint/);
  await h.rpc('save_assignment_page',TERM,'M1','🌐'.repeat(50000));
  await assert.rejects(h.rows("update assignment_pages set body_md='bypass'"),/permission denied/);
  await h.as('owner');assert.ok((await h.rows("select * from audit_log where table_name='assignment_pages'")).length>=5);
});
for(const who of ['grader','a','auditor','outside','anon'])test(`${who}: assignment reads obey role and sharing; all writes denied`,async()=>{
  await h.as(who);
  if(who==='anon')await assert.rejects(h.rows('select * from assignment_pages'),/permission denied/);
  else {
    const rows=await h.rows('select code from assignment_pages order by code');
    assert.deepEqual(rows.map(r=>r.code),who==='outside'?[]:who==='auditor'?['M1']:['M1','M2','O1']);
  }
  if(['anon','outside'].includes(who))await assert.rejects(h.rpc('assignment_catalog',TERM));
  else {
    const catalog=await h.rpc('assignment_catalog',TERM);
    assert.equal(catalog.length,who==='auditor'?1:10);
    assert.ok(catalog.every(i=>Object.keys(i).sort().join(',')==='code,due_at,id,kind,mode,title'));
    assert.doesNotMatch(JSON.stringify(catalog),/Private instructions|body_md|score|graded|submission/);
  }
  await assert.rejects(h.rpc('save_assignment_page',TERM,'M1','Forbidden'));
  await assert.rejects(h.rows("insert into assignment_pages(term_id,code,body_md) values($1,'M3','Forbidden')",[TERM]));
  await assert.rejects(h.rows('delete from assignment_pages'));
});
test('auditor sharing follows the linked assignment or optional item, independently of grade release',async()=>{
  await h.as('owner');await h.rows("update grade_items set released=true where code='O1'");await h.as('auditor');
  assert.equal((await h.rpc('assignment_catalog',TERM)).length,1);
  await h.as('owner');await h.rows("update grade_items set auditor_visible=true where code='O1'");await h.as('auditor');
  assert.deepEqual((await h.rows('select code from assignment_pages order by code')).map(r=>r.code),['M1','O1']);
  await h.as('owner');await h.rows('update assignments set auditor_visible=false where id=1');await h.as('auditor');
  assert.deepEqual((await h.rpc('assignment_catalog',TERM)).map(r=>r.code),['O1']);
});
test('preview can read the student version but cannot write, even with owner privileges',async()=>{
  await h.rpc('set_student_preview','aa1001');assert.equal((await h.rows('select * from assignment_pages')).length,3);
  await assert.rejects(h.rpc('save_assignment_page',TERM,'M1','Forbidden'),/preview|Instructor/i);
  await h.db.query('reset role');
  for(const sql of ["update assignment_pages set body_md='bypass'",'delete from assignment_pages',"insert into assignment_pages(term_id,code) values('spring-2027','M3')"])
    await assert.rejects(h.rows(sql),/preview.*read-only/i);
});
test('archived terms require their own roster; closed terms deny students and all old terms reject writes',async()=>{
  await h.rpc('open_term','Fall 2027');await h.as('owner');
  await h.rows("insert into roster(term_id,uni,name) values('fall-2027','cc1003','New only')");
  await h.rows("delete from roster where term_id=$1 and uni='cc1003'",[TERM]);
  await h.as('c');assert.deepEqual(await h.rows('select * from assignment_pages'),[]);await assert.rejects(h.rpc('assignment_catalog',TERM));
  await h.as('a');assert.equal((await h.rows('select * from assignment_pages')).length,3);
  await h.as('auditor');assert.deepEqual(await h.rows('select * from assignment_pages'),[]);await assert.rejects(h.rpc('assignment_catalog',TERM));
  await h.as('teacher');await assert.rejects(h.rpc('save_assignment_page',TERM,'M1','Archived'),/read-only/);
  await h.as('owner');await h.rows("update terms set status='closed' where id=$1",[TERM]);await h.as('a');assert.deepEqual(await h.rows('select * from assignment_pages'),[]);
  await h.as('grader');assert.equal((await h.rows('select * from assignment_pages')).length,3);
});
