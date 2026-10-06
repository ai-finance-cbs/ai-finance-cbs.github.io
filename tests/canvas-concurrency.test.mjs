import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import {phaseDatabase,TERM} from './helpers/phase-a.mjs';
import {normalizeSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {canvasFixture} from './fixtures/canvas.mjs';
const rpc=async(c,name,...args)=>(await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;

test('real PostgreSQL rejects overlapping Canvas runs and hides publication until commit',{timeout:30000},async()=>{
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
    await a.query('begin');const run=await rpc(a,'begin_canvas_sync',TERM);
    const competing=rpc(b,'begin_canvas_sync',TERM).then(value=>({value}),error=>({error}));
    let blocked=false;
    for(let i=0;i<200;i++){
      blocked=(await owner.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked;
      if(blocked)break;
      await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(blocked,true,'The competing run must wait on the per-term lock.');
    await a.query('commit');assert.match((await competing).error?.message || '',/already running/);
    await a.query('begin');await rpc(a,'publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(canvasFixture())));
    assert.equal((await owner.query('select generation from canvas_courses')).rows[0].generation,null);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,0);
    await a.query('commit');
    assert.equal((await owner.query('select generation from canvas_courses')).rows[0].generation,run.id);
    assert.equal((await owner.query('select count(*)::int n from canvas_submissions')).rows[0].n,78);
    assert.equal((await rpc(b,'publish_canvas_sync',run.id,'{}')).submissions,78);
  } finally {
    await Promise.all(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));
    await pg.stop();
  }
});
