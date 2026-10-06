import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import {phaseDatabase,TERM,people,uid} from './helpers/phase-a.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {canvasFixture} from './fixtures/canvas.mjs';
const rpc=async(c,name,...args)=>(await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;

test('real PostgreSQL serializes Canvas sync and course reset and exposes changes only at commit',{timeout:30000},async()=>{
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  const port=listener.address().port;await new Promise(r=>listener.close(r));
  const pg=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'canvas-pg-')),port,user:'postgres',password:'local-test-only',persistent:false,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try {
    await pg.initialise();await pg.start();
    for(let i=0;i<3;i++){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);}
    const [owner,a,b]=clients,h=await phaseDatabase(owner);
    await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);await h.as('owner');
    for(const c of [a,b])await c.query('set role service_role');
    const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const wait=async pid=>{
      for(let i=0;i<200;i++){
        if((await owner.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked)return;
        await new Promise(r=>setTimeout(r,10));
      }
      assert.fail('The competing operation must wait on the per-term lock.');
    };
    await a.query('begin');const run=await rpc(a,'begin_canvas_sync',TERM);
    const competing=rpc(b,'begin_canvas_sync',TERM).then(value=>({value}),error=>({error}));
    await wait(pid);
    await a.query('commit');assert.match((await competing).error?.message || '',/already running/);
    await a.query('begin');await rpc(a,'publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(canvasFixture())));
    assert.equal((await owner.query('select generation from canvas_courses')).rows[0].generation,null);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,0);
    await a.query('commit');
    assert.equal((await owner.query('select generation from canvas_courses')).rows[0].generation,run.id);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,78);
    assert.equal((await rpc(b,'publish_canvas_sync',run.id,'{}')).submissions,78);
    await b.query('reset role');
    await b.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid('teacher'),email:people.teacher})]);
    await b.query('set role authenticated');
    await rpc(b,'save_canvas_mapping',TERM,'Q1',101,'quiz',1);
    const present=async()=>Number((await owner.query("select count(*) n from attendance where uni='aa1001' and week=1 and status='present'")).rows[0].n);
    assert.equal(await present(),1);
    const corrected=canvasFixture();corrected.submissions.find(s=>s.assignment_id===101&&s.user_id===1).score=null;
    const correction=await rpc(a,'begin_canvas_sync',TERM);
    await a.query('begin');await rpc(a,'publish_canvas_sync',correction.id,JSON.stringify(normalizeSnapshot(corrected)));
    assert.equal(await present(),1,'Readers keep the prior attendance until publication commits.');
    await a.query('commit');assert.equal(await present(),0);
    // Excuses and publication take the same term lock before any student lock.
    const attendanceWorker=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
    await b.query('begin');await rpc(b,'save_attendance',1,'[{"uni":"aa1001","status":"excused","excuse_reason":"Approved"}]');
    const syncAfterExcuse=rpc(a,'begin_canvas_sync',TERM);
    await wait(attendanceWorker);
    await b.query('commit');const arrival=await syncAfterExcuse;
    await rpc(a,'publish_canvas_sync',arrival.id,JSON.stringify(normalizeSnapshot(canvasFixture())));
    assert.equal(await present(),1);
    assert.equal((await owner.query("select excuse_reason from attendance where uni='aa1001' and week=1")).rows[0].excuse_reason,null);
    // A sync that wins the lock prevents a concurrent course change.
    await a.query('begin');const live=await rpc(a,'begin_canvas_sync',TERM);
    const reset=rpc(b,'save_canvas_course',TERM,240316,true).then(value=>({value}),error=>({error}));
    await wait(pid);await a.query('commit');assert.match((await reset).error?.message || '',/current sync/);
    await rpc(a,'fail_canvas_sync',live.id,'failed','Synthetic test end');
    // A reset that wins the lock commits before a new sync can choose its course.
    const worker=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
    await b.query('begin');await rpc(b,'save_canvas_course',TERM,240316,true);
    assert.equal((await owner.query('select course_id::int id from canvas_courses')).rows[0].id,240315);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,78);
    const afterReset=rpc(a,'begin_canvas_sync',TERM).then(value=>({value}),error=>({error}));
    await wait(worker);await b.query('commit');
    const next=await afterReset;assert.equal(next.error,undefined);assert.equal(next.value.course_id,240316);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,0);
  } finally {
    await Promise.all(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
    await pg.stop();
  }
});
