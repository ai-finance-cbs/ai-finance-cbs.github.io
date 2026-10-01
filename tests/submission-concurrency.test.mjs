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
  await b.query('reset role');await b.query('set role service_role');
  const receiptB=await rpc(b,'confirm_submission_upload',second.id,10,'application/pdf');
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
