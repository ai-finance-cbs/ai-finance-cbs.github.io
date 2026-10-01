import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { bootstrapSQL, migrationFiles } from './helpers/database.mjs';
import { phaseDatabase, TERM } from './helpers/phase-a.mjs';
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8');
let h;
before(async()=>{h=await phaseDatabase();});
after(async()=>h?.db.close());

test('009 backfills legacy handouts across terms, strips prefixes, and preserves other file fields',async()=>{
  const db=new PGlite();
  try {
    await db.exec(bootstrapSQL);
    for(const name of migrationFiles.filter(name=>!name.startsWith('009_'))) await db.exec(migration(name));
    await db.exec("insert into terms(id,title,status) values('old-term','Old term','archived-readable'); insert into lecture_files(term_id,week,title,storage_path,released,auditor_visible) values ('spring-2027',3,'In-class: Exercise','exercise.pdf',false,true),('old-term',1,'in-class : Old exercise','old.pdf',true,false),('spring-2027',2,'Lecture notes','notes.pdf',true,true),('spring-2027',4,'In-class:','untitled.pdf',true,false)");
    const before=(await db.query('select * from lecture_files order by storage_path')).rows;
    await db.exec(migration('009_file_category.sql'));
    const after=(await db.query('select * from lecture_files order by storage_path')).rows;
    assert.deepEqual(after.map(f=>[f.title,f.category]),[['Exercise','in_class'],['Lecture notes','notes'],['Old exercise','in_class'],['Untitled file','in_class']]);
    assert.deepEqual(after.map(({title,category,...rest})=>rest),before.map(({title,...rest})=>rest));
    await assert.rejects(db.query("insert into lecture_files(week,title,storage_path,category) values(1,'Bad','bad.pdf','other')"),/check constraint/);
    await assert.rejects(db.query("update lecture_files set category=null"),/not-null/);
  } finally {await db.close();}
});

test('category travels through table reads and snapshots without weakening release or auditor rules',async()=>{
  await h.as('teacher');
  for(const [title,category,shared,released,releaseAt] of [['Notes','notes',true,true,null],['Handout','in_class',true,true,null],['Private','in_class',false,true,null],['Timed','in_class',true,false,'2000-01-01'],['Future','in_class',true,false,'2100-01-01']])
    await h.rows('insert into lecture_files(week,title,storage_path,category,auditor_visible,released,release_at) values(3,$1,$2,$3,$4,$5,$6)',[title,`${title}.pdf`,category,shared,released,releaseAt]);
  for(const [who,names] of [['a',['Handout','Notes','Private','Timed']],['auditor',['Handout','Notes','Timed']],['grader',['Future','Handout','Notes','Private','Timed']]]) {
    await h.as(who);
    const table=await h.rows('select title,category from lecture_files order by title');
    const snapshot=(await h.rpc('class_data')).files.map(({title,category})=>({title,category})).sort((a,b)=>a.title.localeCompare(b.title));
    assert.deepEqual(table.map(f=>f.title),names);assert.deepEqual(snapshot,table);
  }
  await h.as('teacher');await h.rpc('set_student_preview','aa1001');
  const snapshot=(await h.rpc('view_as_student','aa1001')).files;
  assert.equal(snapshot.find(f=>f.title==='Handout').category,'in_class');
  assert.equal(snapshot.find(f=>f.title==='Notes').category,'notes');
  assert.ok(!snapshot.some(f=>f.title==='Future'));
  assert.deepEqual(await h.rows("update lecture_files set category='notes' returning id"),[]);
  await assert.rejects(h.rows("insert into lecture_files(week,title,storage_path,category) values(1,'Preview','preview.pdf','in_class')"),/read-only|row-level security/);
  await h.rpc('set_student_preview',null);
});

test('only instructors can write category; anonymous, student, grader, auditor, and unlisted roles are denied',async()=>{
  for(const who of ['anon','a','grader','auditor','outside']) {
    await h.as(who);
    await assert.rejects(h.rows('insert into lecture_files(week,title,storage_path,category) values(1,$1,$2,$3)',['Blocked',`blocked-${who}.pdf`,'in_class']),/permission denied|row-level security/);
    if(who==='anon') await assert.rejects(h.rows("update lecture_files set category='notes' returning id"),/permission denied/);
    else assert.deepEqual(await h.rows("update lecture_files set category='notes' returning id"),[]);
  }
  await h.as('teacher');
  assert.equal((await h.rows("update lecture_files set category='notes' where title='Handout' returning category"))[0].category,'notes');
  await assert.rejects(h.rows("update lecture_files set term_id='forged'"),/permission denied/);
  await assert.rejects(h.rows("update lecture_files set storage_path='forged.pdf'"),/permission denied/);
});

test('category preserves archived read access and isolation from another term',async()=>{
  await h.as('owner');
  await h.rows("insert into terms(id,title,status) values('spring-2028','Next term','closed')");
  await h.rows("insert into lecture_files(term_id,week,title,storage_path,category,released) values('spring-2028',1,'Next class','next.pdf','in_class',true)");
  await h.as('a');assert.ok(!(await h.rpc('class_data')).files.some(f=>f.title==='Next class'));
  await assert.rejects(h.rpc('class_data','spring-2028'),/Class access/);
  await h.as('owner');
  await h.rows("update terms set status='archived-readable' where id=$1",[TERM]);
  await h.rows("update terms set status='active' where id='spring-2028'");
  await h.as('a');assert.equal((await h.rpc('get_access')).read_only,true);
  assert.ok((await h.rpc('class_data')).files.every(f=>['notes','in_class'].includes(f.category)));
  assert.deepEqual(await h.rows("update lecture_files set category='in_class' returning id"),[]);
  await assert.rejects(h.rows("insert into lecture_files(week,title,storage_path,category) values(1,'Archive','archive.pdf','in_class')"),/read-only|row-level security/);
  await h.as('teacher');assert.deepEqual(await h.rows("update lecture_files set category='in_class' where term_id=$1 returning id",[TERM]),[]);
});
