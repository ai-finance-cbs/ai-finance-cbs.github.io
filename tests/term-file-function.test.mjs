import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHandler} from '../supabase/functions/submission-file/handler.js';
const TERM='spring-2027';
const manifest={term:{id:TERM},items:[{id:1,code:'M1',max_points:10}],roster:[{uni:'aa1001',name:'=danger'}],grades:[{uni:'aa1001',item_id:1,score:0,comment:'A, B'}],files:[{id:'f',week:1,title:'Notes',storage_path:'week-1/notes.pdf'}],submissions:[{id:'s',item_id:1,owner_uni:'aa1001',storage_path:`${TERM}/1/a/new.pdf`,on_time_path:`${TERM}/1/a/old.pdf`,file_name:'work.pdf',member_unis:['aa1001'],link:null},{id:'link',item_id:1,owner_uni:'bb1002',link:'https://video.example/demo'}]};
function setup(options={}) {
  const calls=[];
  const caller={auth:{getUser:async()=>({data:{user:{id:'teacher'}}})},rpc:async(name,args)=>{
    calls.push({caller:name,args});if(name==='get_access')return {data:{role:'instructor',term_id:'spring-2028',...options.access}};
    if(options.denied)return {error:{message:'Export and close first.'}};
    if(name==='term_export_manifest')return {data:manifest};
    if(name==='term_purge_manifest')return {data:{term_id:TERM,objects:[{bucket:'submissions',path:`${TERM}/old.pdf`},{bucket:'lecture-notes',path:'week-1/notes.pdf'}]}};
    assert.fail(name);
  }};
  const service={rpc:async(name,args)=>{calls.push({service:name,args});return {error:options.recordError?{}:null};},storage:{from:bucket=>({
    download:async path=>{calls.push({bucket,download:path});return options.missing?{error:{}}:{data:new Blob(['%PDF-1.7\nContent\n%%EOF'])};},
    remove:async paths=>{calls.push({bucket,remove:paths});return {error:options.removeError?{}:null};},
  })}};
  const handler=createHandler((_,key)=>{if(key==='service'){calls.push('service-client');return service;}return caller;},name=>({SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]);
  return {calls,run:body=>handler(new Request('https://function.example',{method:'POST',headers:{authorization:'Bearer token',origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify(body)}))};
}
test('term export streams a valid ZIP with CSV, both versions, links, and notes before recording success',async()=>{
  const x=setup(),response=await x.run({action:'export',term_id:TERM,path:'attacker.pdf'});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/zip');
  const bytes=Buffer.from(await response.arrayBuffer());
  const result=JSON.parse(execFileSync('python3',['-c',"import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({'names':z.namelist(),'csv':z.read('grades.csv').decode(),'manifest':json.loads(z.read('manifest.json'))}))"],{input:bytes}).toString());
  assert.equal(result.names.length,5);assert.ok(result.names.some(n=>n.includes('on-time')));assert.match(result.csv,/'=danger/);assert.match(result.csv,/"0","A, B"/);assert.equal(result.manifest.submissions[1].link,'https://video.example/demo');
  assert.equal(x.calls.at(-1).service,'record_term_export');assert.deepEqual(x.calls.at(-1).args,{p_term:TERM,p_files:3,p_bytes:66});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('failed or cancelled exports never record success',async()=>{
  const x=setup({missing:true}),response=await x.run({action:'export',term_id:TERM});await assert.rejects(response.arrayBuffer(),/could not read/);assert.ok(!x.calls.some(c=>c.service==='record_term_export'));
  const cancelled=setup(),cancelResponse=await cancelled.run({action:'export',term_id:TERM});await cancelResponse.body.cancel();assert.ok(!cancelled.calls.some(c=>c.service==='record_term_export'));
  const failed=setup({recordError:true}),failedResponse=await failed.run({action:'export',term_id:TERM});await assert.rejects(failedResponse.arrayBuffer(),/could not be recorded/);
});
test('purge uses only the closed-term manifest and records completion after both buckets succeed',async()=>{
  const x=setup();assert.equal((await x.run({action:'purge',term_id:TERM,paths:['victim.pdf']})).status,200);
  assert.deepEqual(x.calls.filter(c=>c.remove),[{bucket:'submissions',remove:[`${TERM}/old.pdf`]},{bucket:'lecture-notes',remove:['week-1/notes.pdf']}]);assert.deepEqual(x.calls.at(-1),{service:'record_term_purge',args:{p_term:TERM}});
  const fail=setup({removeError:true});assert.equal((await fail.run({action:'purge',term_id:TERM})).status,502);assert.ok(!fail.calls.some(c=>c.service==='record_term_purge'));
});
test('term actions deny roles, preview, archived access, invalid terms, and absent database authorization before service access',async()=>{
  for(const access of [{role:'student'},{role:'grader'},{role:'auditor'},{role:'unlisted'},{role:'instructor',view_as:{uni:'a'}},{role:'instructor',read_only:true}])for(const action of ['export','purge']){const x=setup({access});assert.equal((await x.run({action,term_id:TERM})).status,403);assert.ok(!x.calls.includes('service-client'));}
  for(const action of ['export','purge']){const x=setup({denied:true});assert.equal((await x.run({action,term_id:TERM})).status,409);assert.ok(!x.calls.includes('service-client'));const invalid=setup();assert.equal((await invalid.run({action,term_id:'../other'})).status,400);}
});
