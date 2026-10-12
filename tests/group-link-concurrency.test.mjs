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
test('concurrent group members save successfully; the last committed write wins',{timeout:30000},async()=>{
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const pg=new EmbeddedPostgres({databaseDir:await mkdtemp(join(tmpdir(),'m3-pg-')),port,user:'postgres',password:'local-test-only',persistent:false,initdbFlags:['--locale=C','--encoding=UTF8'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try{
    await pg.initialise();await pg.start();for(let i=0;i<3;i++){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);}
    const [owner,a,b]=clients,h=await phaseDatabase(owner),raw=canvasFixture();raw.assignments.forEach(a=>a.due_at=new Date(Date.now()+86400000).toISOString());
    await h.as('teacher');await h.rpc('save_canvas_course',TERM,240315);const run=await h.rpc('request_canvas_sync',TERM);await h.as('service');await h.rpc('publish_canvas_sync',run.id,JSON.stringify(normalizeSnapshot(raw)));await h.as('teacher');await h.rpc('save_canvas_mapping',TERM,'M3',100,'milestone',3);await h.as('owner');
    for(const [client,who] of [[a,'a'],[b,'b']]){await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid(who),email:people[who]})]);await client.query('set role authenticated');}
    const save=(c,link)=>c.query("select save_group_link($1,'M3',$2) row",[TERM,link]);
    await a.query('begin');const first=(await save(a,'https://first.test')).rows[0].row;
    const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const competing=save(b,'https://second.test');let blocked=false;
    for(let i=0;i<200;i++){
      blocked=(await owner.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0]?.blocked;
      if(blocked)break;await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(blocked,true);await a.query('commit');const second=(await competing).rows[0].row;
    assert.equal(first.submitted_by_uni,'aa1001');assert.equal(second.submitted_by_uni,'bb1002');
    const rows=(await owner.query('select * from group_link_submissions')).rows;assert.equal(rows.length,1);assert.equal(rows[0].link,second.link);assert.equal(second.link,'https://second.test');
  }finally{await Promise.all(clients.map(async c=>{await c.query('rollback').catch(()=>{});await c.end();}));await pg.stop();}
});
