import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { phaseDatabase, people, uid } from './helpers/phase-a.mjs';
async function authenticate(client, who) {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid(who),email:people[who]})]);
  await client.query('set role authenticated');
}
const rpc=async(c,name,...args)=>(await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
async function waits(owner,client) {
  const pid=(await client.query('select pg_backend_pid() pid')).rows[0].pid;
  return async () => {
    for(let i=0;i<200;i++) {
      if((await owner.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked) return;
      await new Promise(r=>setTimeout(r,10));
    }
    assert.fail('Competing transaction did not wait for the database lock.');
  };
}
async function database(run) {
  const listener=createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const pg=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'phase-a-pg-')),port,user:'postgres',password:'local-test-only',persistent:false,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try {
    await pg.initialise();await pg.start();
    for(let i=0;i<4;i++){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);}
    const [owner,a,b,grader]=clients,h=await phaseDatabase(owner);
    await authenticate(a,'a');await authenticate(b,'b');await authenticate(grader,'grader');
    await run({h,owner,a,b,grader});
  } finally {
    await Promise.all(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
    await pg.stop();
  }
}
test('real PostgreSQL serializes two group members finishing overlapping uploads', {timeout:30000}, async()=>database(async({h,owner,a,b})=>{
  await h.as('teacher');const set=await h.rpc('create_group_set','Concurrent group',1,4,null);
  const group=(await h.rpc('class_data')).groups.find(g=>g.set_id===set).id;
  await h.rpc('configure_grade_item',2,'file','group',set,null);
  for(const uni of ['aa1001','bb1002'])await h.rpc('choose_group',set,group,uni);
  const first=await h.begin('a',2),receiptA=await h.verify(first);
  await h.as('owner');const wait=await waits(owner,a);
  await b.query('begin');
  const second=await rpc(b,'begin_submission',2,'second.pdf',10,'application/pdf');
  // The second begin supersedes A inside an uncommitted transaction. A still sees its old row.
  await b.query("insert into storage.objects(bucket_id,name) values('submissions',$1)",[second.storage_path]);
  await b.query('reset role');await b.query('set role service_role');
  const receiptB=await rpc(b,'confirm_submission_upload',second.term_id,second.id,10,'application/pdf');
  await authenticate(b,'b');
  const competing=rpc(a,'finish_submission',first.id,receiptA).then(value=>({value}),error=>({error}));
  await wait();
  const result=await rpc(b,'finish_submission',second.id,receiptB);
  await b.query('commit');
  assert.match((await competing).error?.message || '',/expired|superseded|unavailable|replaced/i);
  const rows=(await owner.query('select * from submissions')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].storage_path,second.storage_path);
  assert.equal(rows[0].id,result.submission.id);assert.deepEqual(rows[0].member_unis,['aa1001','bb1002']);
  assert.equal((await owner.query('select * from pending_uploads')).rows.length,0);
}));
test('real PostgreSQL finish waits for a concurrent grade and preserves the graded object', {timeout:30000}, async()=>database(async({h,owner,a,grader})=>{
  const original=await h.begin();await h.finish(original);
  const next=await h.begin(),receipt=await h.verify(next);
  await h.as('owner');const wait=await waits(owner,a);
  await grader.query('begin');await rpc(grader,'save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:9,comment:'Keep this version.'}]));
  const competing=rpc(a,'finish_submission',next.id,receipt).then(value=>({value}),error=>({error}));
  await wait();await grader.query('commit');
  assert.match((await competing).error?.message || '',/Graded, locked/);
  const rows=(await owner.query('select * from submissions')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].storage_path,original.storage_path);assert.ok(rows[0].graded_at);
}));

test('real PostgreSQL early zero scores serialize against the first individual and group finish', {timeout:30000}, async()=>database(async({h,owner,a,grader})=>{
  for(const item of [1,2]) {
    if(item===2) {
      await h.as('teacher');const set=await h.rpc('create_group_set','Early group grade',1,4,null);
      const group=(await h.rpc('class_data')).groups.find(g=>g.set_id===set).id;
      await h.rpc('configure_grade_item',2,'file','group',set,null);
      for(const uni of ['aa1001','bb1002'])await h.rpc('choose_group',set,group,uni);
    }
    const pending=await h.begin('a',item),receipt=await h.verify(pending);
    await h.as('owner');const wait=await waits(owner,a);
    await grader.query('begin');await rpc(grader,'save_grades',JSON.stringify([{uni:item===1?'aa1001':'bb1002',item_id:item,score:0}]));
    const competing=rpc(a,'finish_submission',pending.id,receipt).then(value=>({value}),error=>({error}));
    await wait();await grader.query('commit');assert.match((await competing).error?.message || '',/Graded, locked/);
    assert.equal((await owner.query('select id from submissions where item_id=$1',[item])).rows.length,0);
    // Reverse the race: first finish commits while grading waits, then the new row must lock.
    const uni=item===1?'aa1001':'bb1002';await h.as('grader');
    await h.rpc('save_grades',JSON.stringify([{uni,item_id:item,score:null}]));
    const next=await h.begin('a',item),nextReceipt=await h.verify(next);await h.as('owner');
    const gradeWait=await waits(owner,grader);await a.query('begin');
    const accepted=await rpc(a,'finish_submission',next.id,nextReceipt);
    const grading=rpc(grader,'save_grades',JSON.stringify([{uni,item_id:item,score:0}])).then(value=>({value}),error=>({error}));
    await gradeWait();await a.query('commit');assert.equal((await grading).error,undefined);
    const row=(await owner.query('select id,graded_at from submissions where item_id=$1',[item])).rows[0];
    assert.equal(row.id,accepted.submission.id);assert.ok(row.graded_at);

  }
}));

for(const first of ['delete','finish']) test(`real PostgreSQL ${first} wins concurrent group delete versus finish with the current uploader rechecked`,{timeout:30000},async()=>database(async({h,owner,a,b})=>{
  await h.as('teacher');const set=await h.rpc('create_group_set','Delete race',1,4,null),group=(await h.rpc('class_data')).groups.find(g=>g.set_id===set).id;
  await h.rpc('configure_grade_item',2,'file','group',set,null);
  for(const uni of ['aa1001','bb1002'])await h.rpc('choose_group',set,group,uni);
  const original=await h.begin('a',2),saved=await h.finish(original);
  const pending=await h.begin('b',2),receipt=await h.verify(pending);
  await h.as('owner');
  const actor=first==='delete'?a:b,competitor=first==='delete'?b:a,wait=await waits(owner,competitor);
  await actor.query('begin');
  if(first==='delete') {
    const paths=await rpc(a,'delete_submission',saved.submission.id);
    assert.deepEqual(paths.sort(),[original.storage_path,pending.storage_path].sort());
    const competing=rpc(b,'finish_submission',pending.id,receipt).then(value=>({value}),error=>({error}));
    await wait();await a.query('commit');assert.match((await competing).error?.message || '',/expired|superseded|not found/i);
  } else {
    await rpc(b,'finish_submission',pending.id,receipt);
    const competing=rpc(a,'delete_submission',saved.submission.id).then(value=>({value}),error=>({error}));
    await wait();await b.query('commit');
    const result=await competing;assert.equal(result.error?.message,'Only the member who uploaded this file can delete it. You can replace it.');
    const current=(await owner.query('select * from submissions')).rows;
    assert.equal(current.length,1);assert.equal(current[0].submitted_by,'bb1002');assert.equal(current[0].storage_path,pending.storage_path);
    assert.equal((await owner.query("select * from audit_log where table_name='submissions' and operation='DELETE'")).rows.length,0);
    assert.deepEqual(await rpc(b,'delete_submission',saved.submission.id),[pending.storage_path]);
  }
  assert.equal((await owner.query('select * from submissions')).rows.length,0);
  assert.equal((await owner.query('select * from pending_uploads')).rows.length,0);
  const logs=(await owner.query("select * from audit_log where table_name='submissions' and operation='DELETE'")).rows;
  assert.equal(logs.length,1);assert.equal(logs[0].old_row.storage_path,first==='delete'?original.storage_path:pending.storage_path);
  // A deliberate upload started after deletion is a new submission, with a new ID.
  const fresh=await h.begin('a',2),accepted=await h.finish(fresh);assert.notEqual(accepted.submission.id,saved.submission.id);
}));

test('real PostgreSQL deletion waits for grading and then refuses a newly locked submission',{timeout:30000},async()=>database(async({h,owner,a,grader})=>{
  const pending=await h.begin(),saved=await h.finish(pending);
  await h.as('owner');const wait=await waits(owner,a);
  await grader.query('begin');await rpc(grader,'save_grades',JSON.stringify([{uni:'aa1001',item_id:1,score:0}]));
  const competing=rpc(a,'delete_submission',saved.submission.id).then(value=>({value}),error=>({error}));
  await wait();await grader.query('commit');assert.match((await competing).error?.message || '',/Graded, locked/);
  assert.equal((await owner.query('select storage_path from submissions')).rows[0].storage_path,pending.storage_path);
}));
