// Historical archive workflow: run before migration 019 retires submission and group writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
const fixture=async task=>{const h=await phaseDatabase(undefined,'018_canvas_mirror.sql');try{await task(h);}finally{await h.db.close();}};

test('group grade baselines survive individual overrides and never reach student or preview snapshots',()=>fixture(async h=>{
  await h.as('teacher');const set=await h.rpc('create_group_set','Teams',2,4,null);
  const group=(await h.rows('select id from class_groups where set_id=$1 order by number',[set]))[0].id;
  for(const uni of ['aa1001','bb1002'])await h.rpc('choose_group',set,group,uni);
  await h.rpc('configure_grade_item',2,'file','group',set,null);
  await h.finish(await h.begin('a',2));
  await h.as('grader');await h.rpc('grade_group',2,group,7,'Shared feedback');
  let d=await h.rpc('class_data');assert.equal(d.group_grades[0].score,7);assert.equal(d.grades.filter(g=>g.item_id===2&&g.score===7).length,2);
  await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:2,score:9,comment:'Member feedback'}]));
  d=await h.rpc('class_data');assert.equal(d.group_grades[0].score,7);assert.equal(d.grades.find(g=>g.uni==='aa1001').score,9);
  for(const who of ['a','b','auditor']){await h.as(who);assert.equal((await h.rpc('class_data')).group_grades,undefined);assert.deepEqual(await h.rows('select * from group_grade_records'),[]);}
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');assert.equal((await h.rpc('view_as_student','aa1001')).group_grades,undefined);
  await assert.rejects(h.rpc('grade_group',2,group,5,'Forbidden'),/read-only/);
}));

test('settings require a linked set for group mode and block ownership changes after submission',()=>fixture(async h=>{
  await h.as('teacher');await assert.rejects(h.rpc('configure_grade_item',4,'file','group',null,null),/Choose a group set/);
  const set=await h.rpc('create_group_set','Teams',1,4,null);
  await h.rpc('configure_grade_item',4,'file','group',set,'2027-03-15T13:00:00Z');
  assert.equal((await h.rpc('class_data')).items.find(i=>i.id===4).mode,'group');
  await h.finish(await h.begin('a',1));
  await h.as('teacher');await assert.rejects(h.rpc('configure_grade_item',1,'file','group',set,null),/after work has been submitted/);
}));

test('opening a term copies settings with new item IDs, clears dates, and keeps old grades read-only',()=>fixture(async h=>{
  await h.as('teacher');await h.rpc('set_session_times',1,'2027-03-13T14:00:00Z','2027-03-13T17:00:00Z');
  await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:8,comment:'Old feedback'}]));await h.rpc('release_grade_item',1,true);
  const next=await h.rpc('open_term','Spring 2028');assert.equal(next,'spring-2028');
  let d=await h.rpc('class_data');assert.equal(d.term_id,next);assert.equal(d.items.length,16);assert.ok(d.items.every(i=>i.id>16&&!i.released&&i.due_at===null));assert.ok(d.sessions.every(s=>!s.date&&!s.starts_at&&!s.ends_at));assert.deepEqual(d.grades,[]);assert.deepEqual(d.submissions,[]);
  await h.rpc('replace_roster',JSON.stringify([{uni:'cc1003',name:'Next student'}]));
  await h.as('a');const access=await h.rpc('get_access');assert.equal(access.term_id,TERM);assert.equal(access.read_only,true);assert.equal((await h.rpc('class_data')).grades[0].score,8);
  await assert.rejects(h.rpc('submit_link',6,'https://video.example/old'),/read-only/);
  await h.as('c');d=await h.rpc('class_data');assert.equal(d.term_id,next);assert.deepEqual(d.grades,[]);
  await h.as('teacher');await assert.rejects(h.rpc('open_term','Spring 2028'),/already exists/);
}));

test('export gates closure; only the service can record it; purge keeps grades and audit metadata',()=>fixture(async h=>{
  const pending=await h.begin('a',1);await h.finish(pending);
  await h.as('teacher');await h.rpc('save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:0,comment:'Keep me'}]));
  await h.rpc('open_term','Spring 2028');
  await assert.rejects(h.rpc('close_previous_term',TERM),/export before closing/);
  await assert.rejects(h.rpc('term_purge_manifest',TERM),/Export and close/);
  await assert.rejects(h.rpc('record_term_export',TERM,1,10),/permission denied/);
  const manifest=await h.rpc('term_export_manifest',TERM);assert.equal(manifest.submissions.length,1);assert.equal(manifest.grades[0].comment,'Keep me');
  await h.as('service');await h.rpc('record_term_export',TERM,1,10);
  await h.as('teacher');await h.rpc('close_previous_term',TERM);
  const purge=await h.rpc('term_purge_manifest',TERM);assert.deepEqual(purge.objects,[{bucket:'submissions',path:pending.storage_path}]);
  await h.as('a');assert.equal((await h.rpc('get_access')).role,'unlisted');await assert.rejects(h.rpc('class_data',TERM),/Class access/);
  await h.as('service');await assert.rejects(h.rpc('record_term_purge',TERM),/Stored files remain/);
  // Simulate Storage API success; production SQL never deletes storage.objects.
  await h.as('owner');await h.rows('delete from storage.objects where name=$1',[pending.storage_path]);
  await h.as('service');await h.rpc('record_term_purge',TERM);
  await h.as('teacher');const overview=await h.rpc('staff_overview');assert.ok(overview.terms.find(t=>t.id===TERM).purged_at);
  assert.equal((await h.rpc('class_data',TERM)).grades[0].score,0);
  assert.ok((await h.rows("select * from audit_log where table_name='submissions'")).length);
}));

test('rollover, export, purge, and storage reporting deny every non-instructor and preview',()=>fixture(async h=>{
  for(const who of ['anon','a','grader','auditor','outside']) {
    await h.as(who);
    for(const [name,args] of [['open_term',['Spring 2028']],['close_previous_term',[TERM]],['term_export_manifest',[TERM]],['term_purge_manifest',[TERM]],['staff_overview',[]],['lecture_orphans',[]],['record_term_export',[TERM,0,0]],['record_term_purge',[TERM]]])await assert.rejects(h.rpc(name,...args),/Instructor|permission denied/);
  }
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  for(const [name,args] of [['open_term',['Spring 2028']],['close_previous_term',[TERM]],['term_export_manifest',[TERM]],['term_purge_manifest',[TERM]],['staff_overview',[]],['lecture_orphans',[]]])await assert.rejects(h.rpc(name,...args),/read-only/);
  await h.rpc('set_student_preview',null);await assert.rejects(h.rpc('close_previous_term',TERM),/archived/);
}));

test('storage overview counts object metadata, and purge scopes paths to one closed term',()=>fixture(async h=>{
  await h.as('owner');await h.rows('alter table storage.objects add column metadata jsonb');
  await h.rows("insert into storage.objects(bucket_id,name,metadata) values('submissions','spring-2027/orphan.pdf','{\"size\":256}'),('submissions','spring-2028/new.pdf','{\"size\":512}')");
  await h.as('teacher');assert.equal((await h.rpc('staff_overview')).storage_bytes,768);
  await h.rpc('open_term','Spring 2028');await h.as('service');await h.rpc('record_term_export',TERM,0,0);await h.as('teacher');await h.rpc('close_previous_term',TERM);
  assert.deepEqual((await h.rpc('term_purge_manifest',TERM)).objects,[{bucket:'submissions',path:'spring-2027/orphan.pdf'}]);
}));


test('lecture orphan list excludes references in active, archived, and closed terms; export exposes only its objects',()=>fixture(async h=>{
  await h.as('owner');await h.rows('alter table storage.objects add column metadata jsonb');
  await h.rows("insert into lecture_files(week,title,storage_path) values(1,'Old notes','week-1/old.pdf')");
  await h.rows("insert into storage.objects(bucket_id,name,metadata) values('lecture-notes','week-1/old.pdf','{\"size\":10}'),('lecture-notes','legacy/orphan.pdf','{\"size\":20}'),('submissions','ignore.pdf','{\"size\":30}')");
  await h.as('teacher');await h.rpc('open_term','Spring 2028');
  await h.rows("insert into lecture_files(week,title,storage_path) values(2,'New notes','week-2/new.pdf')");
  await h.as('owner');await h.rows("insert into storage.objects(bucket_id,name,metadata) values('lecture-notes','week-2/new.pdf','{\"size\":40}')");
  await h.as('teacher');assert.deepEqual((await h.rpc('term_export_manifest',TERM)).storage_objects,[{bucket:'lecture-notes',path:'week-1/old.pdf',size:10}]);
  const expected=[{path:'legacy/orphan.pdf',size:20}];assert.deepEqual(await h.rpc('lecture_orphans'),expected);
  await h.as('service');await h.rpc('record_term_export',TERM,1,10,JSON.stringify([{path:'missing.pdf'}]));
  await h.as('teacher');const term=(await h.rpc('staff_overview')).terms.find(t=>t.id===TERM);assert.equal(term.file_count,1);assert.equal(term.byte_count,10);assert.deepEqual(term.missing_files,[{path:'missing.pdf'}]);
  await h.rpc('close_previous_term',TERM);assert.deepEqual(await h.rpc('lecture_orphans'),expected);
}));
