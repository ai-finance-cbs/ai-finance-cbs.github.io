import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canvasFixture} from './fixtures/canvas.mjs';
import {HOST,canvasClient,allowedURL,nextPage,normalizeSnapshot,effectiveAssignment,collectSnapshot} from '../supabase/functions/canvas-sync/client.js';
import {createHandler,sameSecret} from '../supabase/functions/canvas-sync/handler.js';
import {canvasStatus,canvasPresent,canvasPosted,mappingValues,canvasItems,suggestedAssignment} from '../assets/materials/canvas-core.js';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
function fixtureFetch(log=[]) {
  const f=canvasFixture();
  return async(url,options)=>{
    log.push({url,options});const u=new URL(url),path=u.pathname;
    if(path.endsWith('/enrollments'))return json(f.enrollments);
    if(path.endsWith('/assignments'))return json(f.assignments.map(({overrides,...a})=>a));
    if(path.endsWith('/overrides'))return json([]);
    if(path.endsWith('/submissions'))return json(f.submissions);
    if(path.endsWith('/group_categories'))return json([{id:7,name:'Project'}]);
    if(path.endsWith('/groups'))return json(f.groups);
    if(path.endsWith('/users'))return json(f.group_members);
    throw new Error('Unexpected fixture route');
  };
}
test('collects the six-student, thirteen-assignment course through every endpoint without network',async()=>{
  const calls=[],d=await collectSnapshot(240315,canvasClient('fixture-token',{fetch:fixtureFetch(calls)}));
  assert.equal(d.enrollments.length,6);assert.equal(d.assignments.length,13);assert.equal(d.submissions.length,78);assert.equal(d.groups.length,1);
  assert.ok(calls.every(c=>c.url.startsWith(HOST+'/api/v1/')&&c.options.headers.Authorization==='Bearer fixture-token'&&c.options.redirect==='error'));
  assert.ok(calls.some(c=>c.url.includes('override_assignment_dates=false')));
});
test('pagination follows opaque Link URLs, accepts header variants, and rejects unsafe, broken, or looping links',async()=>{
  let calls=0;const next=HOST+'/api/v1/courses/240315/assignments?page=2&opaque=yes';
  const pages=canvasClient('fixture',{fetch:async url=>{calls++;return url===next?json([{id:2}]):json([{id:1}],200,{Link:`<${next}>; rel=next`});}});
  assert.deepEqual(await pages('/api/v1/courses/240315/assignments'),[{id:1},{id:2}]);assert.equal(calls,2);
  for(const value of ['https://evil.test/api/v1/a','http://courseworks2.columbia.edu/api/v1/a',HOST+'/login','https://user:pass@courseworks2.columbia.edu/api/v1/a'])assert.throws(()=>allowedURL(value),/unsafe/);
  assert.throws(()=>nextPage('broken pagination'),/pagination/);
  await assert.rejects(canvasClient('fixture',{fetch:async()=>json([],200,{Link:`<${next}>; rel="next"`})})('/api/v1/a'),/pagination/);
  await assert.rejects(canvasClient('fixture',{fetch:async()=>json([],200,{Link:'<https://evil.test/api/v1/steal>; rel="next"'})})('/api/v1/a'),/unsafe/);
});
test('403/429 throttles have bounded backoff; invalid credentials never retry',async()=>{
  for(const code of [403,429]) {
    let calls=0;const waits=[];
    const pages=canvasClient('fixture',{sleep:async ms=>waits.push(ms),fetch:async()=>++calls<3?json({errors:[{message:'Rate Limit Exceeded'}]},code):json([])});
    await pages('/api/v1/a');assert.equal(calls,3);assert.equal(waits.length,2);assert.ok(waits.every(n=>n<=5000));
  }
  let calls=0;await assert.rejects(canvasClient('fixture',{sleep:async()=>{},fetch:async()=>{calls++;return json({},429);}})('/api/v1/a'),/rate limit/);assert.equal(calls,4);
  for(const code of [401,403]) {
    let calls=0;await assert.rejects(canvasClient('fixture',{fetch:async()=>{calls++;return json({error:'Invalid access token'},code);}})('/api/v1/a'),e=>e.status==='auth_failed');assert.equal(calls,1);
  }
});
test('effective dates respect student/group/section precedence, unlimited dates, visibility, and cached student dates',()=>{
  const a={published:true,due_at:'2027-03-01T00:00:00Z',overrides:[{course_section_id:10,due_at:'2027-03-03T00:00:00Z'},{group_id:80,due_at:'2027-03-04T00:00:00Z'},{student_ids:[1],due_at:'2027-03-02T00:00:00Z'}]};
  const u={user_id:'1',section_ids:['10']},members=[{group_id:'80',user_id:'1'}];
  assert.equal(effectiveAssignment(a,u,members).due,'2027-03-02T00:00:00.000Z');
  a.overrides.pop();assert.equal(effectiveAssignment(a,u,members).due,'2027-03-04T00:00:00.000Z');
  a.overrides.pop();assert.equal(effectiveAssignment(a,u,members).due,'2027-03-03T00:00:00.000Z');
  a.overrides.push({student_ids:[1],due_at:null});assert.equal(effectiveAssignment(a,u,members).due,null);
  assert.equal(effectiveAssignment({...a,only_visible_to_overrides:true},{user_id:'2',section_ids:[]},[]).visible,false);
  const f=canvasFixture();f.submissions[0].cached_due_date=null;const s=normalizeSnapshot(f).submissions[0];assert.equal(s.cached_due_at,null);
});
test('normalizer drops private fields, refuses malformed/duplicate records, and combines multiple enrollments',()=>{
  const f=canvasFixture();f.submissions[0].submission_comments=[{comment:'private'}];f.enrollments[0].user.sis_user_id='private-sis-id';f.enrollments.push({...f.enrollments[0],course_section_id:20});
  const d=normalizeSnapshot(f);assert.deepEqual(d.enrollments[0].section_ids,['10','20']);assert.ok(!JSON.stringify(d).includes('private'));assert.ok(d.enrollments.every(e=>!Object.hasOwn(e,'sis_user_id')));
  f.submissions.push(f.submissions[0]);assert.throws(()=>normalizeSnapshot(f),/duplicate/);f.submissions.pop();
  f.submissions[0].missing=null;assert.throws(()=>normalizeSnapshot(f),/flags/);
});
test('status precedence, posted-only flags, and missing-policy attendance handle zero and paper scores',()=>{
  const base={assignment_visible:true,workflow_state:'unsubmitted',missing:false,late:false,excused:false,score:null,late_policy_status:null,cached_due_at:'2027-03-01T00:00:00Z'};
  assert.equal(canvasStatus({...base,excused:true,missing:true,late:true}),'Excused');
  assert.equal(canvasStatus({...base,missing:true,workflow_state:'graded',score:0}),'Missing');
  assert.equal(canvasStatus({...base,late:true,workflow_state:'graded'}),'Late');
  for(const workflow_state of ['submitted','pending_review','graded'])assert.equal(canvasStatus({...base,workflow_state}),'Done');
  assert.equal(canvasStatus(base,{},Date.parse('2027-02-28')),'Not yet due');assert.equal(canvasStatus(base,{},Date.parse('2027-03-02')),'Missing');
  assert.equal(canvasStatus({...base,cached_due_at:null}),'No due date');assert.equal(canvasStatus(null),'Status unavailable');
  assert.equal(canvasStatus({...base,assignment_visible:false}),'Not assigned');assert.equal(canvasStatus(base,{kind:'optional'}),'Optional');
  assert.equal(canvasStatus({...base,missing:true,score:0,late_policy_status:'missing'},{kind:'optional'}),'Optional');
  for(const score of [0,2])assert.equal(canvasPresent({...base,score}),true);
  for(const changes of [{score:null},{score:0,missing:true},{score:0,late_policy_status:'missing'}])assert.equal(canvasPresent({...base,...changes}),false);
  assert.equal(canvasPosted({...base,score:2}),false);assert.equal(canvasPosted({...base,posted_at:'2027-01-01'}),true);assert.equal(canvasPosted({...base,posted_at:'2027-01-01',assignment_visible:false}),false);
});
test('mapping validates kind/week, allows Q6 independent of old items, and only suggests unambiguous names',()=>{
  assert.equal(mappingValues('q6','101','quiz',6).site_key,'Q6');
  for(const args of [['Q6',101,'quiz',5],['FP',101,'final',null],['M1','bad','milestone',1],['PA',101,'participation',1]])assert.throws(()=>mappingValues(...args));
  assert.equal(canvasItems([]).length,6);
  assert.equal(suggestedAssignment({title:'Milestone #1'},[{id:1,name:'Milestone 1'}]).id,1);
  assert.equal(suggestedAssignment({title:'Milestone #1'},[{id:1,name:'Milestone 1'},{id:2,name:'Milestone #1'}]),null);
});
function handlerSetup({role='instructor',preview=false,valid=true,fetch=fixtureFetch(),publishError=false,cronSecret='fixture-cron'}={}) {
  const calls=[],run={id:'run-1',term_id:'spring-2027',course_id:240315};
  const env=name=>({SUPABASE_URL:'local',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',CRON_SECRET:cronSecret,CANVAS_TOKEN:'fixture-token'})[name];
  const createClient=(_,key)=>({auth:{getUser:async()=>({data:valid?{user:{id:'teacher'}}:null,error:valid?null:{message:'invalid'}})},rpc:async(name,args)=>{
    calls.push({key,name,args});
    if(name==='get_access')return {data:{role,view_as:preview?{}:null,term_id:'spring-2027'}};
    if(name.includes('begin_canvas')||name==='request_canvas_sync')return {data:run};
    if(name==='publish_canvas_sync')return publishError?{error:{message:'private database detail'}}:{data:{assignments:13}};
    return {data:null};
  }});
  return {handler:createHandler(createClient,env,{fetch,sleep:async()=>{}}),calls};
}
const request=headers=>new Request('http://local/canvas-sync',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({term_id:'spring-2027'})});
test('instructor JWT and cron secret are separate verified entry paths',async()=>{
  for(const headers of [{authorization:'Bearer fixture-jwt'},{'x-cron-secret':'fixture-cron'}]) {
    const {handler,calls}=handlerSetup();assert.equal((await handler(request(headers))).status,200);
    assert.ok(calls.some(c=>c.name==='publish_canvas_sync' && c.key==='service'));
    assert.ok(calls.some(c=>c.name===('authorization' in headers?'request_canvas_sync':'begin_canvas_sync')));
  }
});
for(const role of ['student','grader','auditor','unlisted','preview','invalid','anonymous','bad-cron'])test(`sync denies ${role} before creating a run or fetching Canvas`,async()=>{
  const {handler,calls}=handlerSetup({role:role==='preview'?'instructor':role,preview:role==='preview',valid:role!=='invalid',fetch:async()=>{throw new Error('Must not fetch');}});
  const headers=role==='anonymous'?{}:role==='bad-cron'?{'x-cron-secret':'wrong'}:{authorization:'Bearer fixture-jwt'};
  assert.ok([401,403].includes((await handler(request(headers))).status));assert.ok(!calls.some(c=>c.name.includes('sync')));
});
test('auth failures and mid-fetch failures retain snapshots and record redacted run errors',async()=>{
  for(const [fetch,status] of [[async()=>json({},401),'auth_failed'],[async()=>{throw new Error('fixture-token private failure');},'failed']]) {
    const {handler,calls}=handlerSetup({fetch});const response=await handler(request({'x-cron-secret':'fixture-cron'}));
    assert.equal(response.status,502);assert.ok(!JSON.stringify(await response.json()).includes('fixture-token'));
    assert.ok(!calls.some(c=>c.name==='publish_canvas_sync'));assert.equal(calls.at(-1).args.p_status,status);
  }
  const {handler,calls}=handlerSetup({publishError:true});assert.equal((await handler(request({'x-cron-secret':'fixture-cron'}))).status,502);assert.equal(calls.at(-1).name,'fail_canvas_sync');
});

test('cron secret digest comparison handles equality, different lengths, and first or last byte mismatches',async()=>{
  for(const value of ['fixture-cron','', 'Unicode-교수-🔒', 'a'.repeat(2048)])assert.equal(await sameSecret(value,value),true);
  for(const value of ['Fixture-cron','fixture-crom','fixture-cronx','fixture-cro','', 'fixture-cron\u0000'])assert.equal(await sameSecret(value,'fixture-cron'),false);
  for(const secret of ['',null,undefined]) {
    const {handler,calls}=handlerSetup({cronSecret:secret===undefined?null:secret});
    assert.equal((await handler(request({'x-cron-secret':'fixture-cron'}))).status,401);assert.deepEqual(calls,[]);
  }
  for(const provided of ['Fixture-cron','fixture-crom','fixture-cronx']) {
    const {handler,calls}=handlerSetup();assert.equal((await handler(request({'x-cron-secret':provided}))).status,401);assert.deepEqual(calls,[]);
  }
});
