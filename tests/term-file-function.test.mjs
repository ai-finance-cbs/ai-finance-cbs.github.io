import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/submission-file/handler.js';
const TERM='spring-2027';
const base={term:{id:TERM},items:[{id:1,code:'M1',max_points:10}],roster:[{uni:'aa1001',name:'=danger'}],grades:[{uni:'aa1001',item_id:1,score:0,comment:'A, B'}],files:[{id:'f',week:1,title:'Notes',storage_path:'week-1/notes.pdf'}],submissions:[{id:'s',item_id:1,owner_uni:'aa1001',storage_path:`${TERM}/1/a/new.pdf`,on_time_path:`${TERM}/1/a/old.pdf`,file_name:'work.pdf',member_unis:['aa1001'],link:null},{id:'link',item_id:1,owner_uni:'bb1002',link:'https://video.example/demo'}]};
const objects=[{bucket:'submissions',path:`${TERM}/1/a/new.pdf`,size:22},{bucket:'submissions',path:`${TERM}/1/a/old.pdf`,size:22},{bucket:'lecture-notes',path:'week-1/notes.pdf',size:22}];
function setup(options={}) {
  const calls=[],manifest={...base,storage_objects:options.objects ?? objects,...options.manifest};
  const caller={auth:{getUser:async()=>({data:{user:{id:options.actor || 'teacher'}}})},rpc:async(name,args)=>{
    calls.push({caller:name,args});if(name==='get_access')return {data:{role:'instructor',term_id:'spring-2028',...options.access}};
    if(options.denied)return {error:{message:'Export and close first.'}};
    if(name==='term_export_manifest')return {data:manifest};
    if(name==='term_purge_manifest')return {data:{term_id:TERM,objects:[{bucket:'submissions',path:`${TERM}/old.pdf`},{bucket:'lecture-notes',path:'week-1/notes.pdf'}]}};
    assert.fail(name);
  }};
  const service={rpc:async(name,args)=>{calls.push({service:name,args});return {error:options.recordError?{}:null};},storage:{from:bucket=>({
    createSignedUrls:async(paths,ttl,opts)=>{calls.push({bucket,paths,ttl,opts});return options.signError?{error:{}}:{data:paths.map(path=>path===options.missingPath?{path,error:'Object not found'}:{path,signedUrl:`https://storage.example/${path}?token=private`})};},
    download:()=>assert.fail('File bytes must never enter the Edge Function'),
    remove:async paths=>{calls.push({bucket,remove:paths});return {error:options.removeError?{}:null};},
  })}};
  const handler=createHandler((_,key)=>{if(key==='service'){calls.push('service-client');return service;}return caller;},name=>({SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'})[name]);
  return {calls,run:body=>handler(new Request('https://function.example',{method:'POST',headers:{authorization:'Bearer token',origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify(body)}))};
}
const record=manifest=>({action:'record',term_id:TERM,ticket:manifest.ticket,file_count:manifest.file_count,byte_count:manifest.byte_count,missing_files:manifest.metadata.missing_files});
test('export returns metadata, CSV and 300-second URLs; only verified browser completion records it',async()=>{
  const x=setup(),response=await x.run({action:'export',term_id:TERM,path:'attacker.pdf'});assert.equal(response.status,200);
  const m=await response.json();assert.equal(m.files.length,3);assert.ok(m.files.some(f=>f.name.includes('on-time')));assert.match(m.csv,/'=danger/);assert.match(m.csv,/"0","A, B"/);assert.equal(m.metadata.submissions[1].link,'https://video.example/demo');
  assert.equal(m.file_count,3);assert.equal(m.byte_count,66);assert.ok(x.calls.filter(c=>c.paths).every(c=>c.ttl===300&&c.opts.download));
  assert.ok(!x.calls.some(c=>c.service==='record_term_export'));assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await x.run(record(m))).status,200);assert.deepEqual(x.calls.at(-1).args,{p_term:TERM,p_files:3,p_bytes:66,p_missing:[]});
});
test('missing objects are listed without blocking export; unrelated signing failures do not record success',async()=>{
  const x=setup({objects:objects.slice(1),missingPath:objects[1].path});const m=await (await x.run({action:'export',term_id:TERM})).json();
  assert.equal(m.files.length,1);assert.equal(m.metadata.missing_files.length,2);assert.equal(m.byte_count,22);
  assert.equal((await x.run(record(m))).status,200);assert.equal(x.calls.at(-1).args.p_missing.length,2);
  const empty=setup({objects:[]});const zero=await (await empty.run({action:'export',term_id:TERM})).json();assert.equal(zero.file_count,0);assert.equal(zero.metadata.missing_files.length,3);assert.equal((await empty.run(record(zero))).status,200);
  const fail=setup({signError:true});assert.equal((await fail.run({action:'export',term_id:TERM})).status,502);assert.ok(!fail.calls.some(c=>c.service));
});
test('completion rejects forged, expired, cross-actor and cross-term tickets, count changes and missing-file changes',async()=>{
  const x=setup(),m=await (await x.run({action:'export',term_id:TERM})).json(),good=record(m);
  for(const change of [{ticket:null},{file_count:2},{byte_count:65},{file_count:'3'},{missing_files:[{path:'fake'}]},{term_id:'spring-2026'},{ticket:{...m.ticket,payload:m.ticket.payload.replace('teacher','attacker')}}])assert.equal((await x.run({...good,...change})).status,409);
  const other=setup({actor:'other'});assert.equal((await other.run(good)).status,409);
  const now=Date.now;try{Date.now=()=>now()+3600001;assert.equal((await x.run(good)).status,409);}finally{Date.now=now;}
  assert.ok(!x.calls.some(c=>c.service));const fail=setup({recordError:true});assert.equal((await fail.run(good)).status,409);
});
test('export signs large file lists in bounded batches',async()=>{
  const files=Array.from({length:205},(_,i)=>({id:`f${i}`,week:1,title:`Notes ${i}`,storage_path:`week-1/${i}.pdf`}));
  const x=setup({manifest:{files,submissions:[]},objects:files.map(f=>({bucket:'lecture-notes',path:f.storage_path,size:1}))});
  const m=await (await x.run({action:'export',term_id:TERM})).json();assert.equal(m.file_count,205);assert.deepEqual(x.calls.filter(c=>c.paths).map(c=>c.paths.length),[100,100,5]);
});
test('purge uses only the closed-term manifest and records completion after both buckets succeed',async()=>{
  const x=setup();assert.equal((await x.run({action:'purge',term_id:TERM,paths:['victim.pdf']})).status,200);
  assert.deepEqual(x.calls.filter(c=>c.remove),[{bucket:'submissions',remove:[`${TERM}/old.pdf`]},{bucket:'lecture-notes',remove:['week-1/notes.pdf']}]);assert.deepEqual(x.calls.at(-1),{service:'record_term_purge',args:{p_term:TERM}});
  const fail=setup({removeError:true});assert.equal((await fail.run({action:'purge',term_id:TERM})).status,502);assert.ok(!fail.calls.some(c=>c.service==='record_term_purge'));
});
test('export, record and purge deny roles, preview, archived access, invalid terms, and absent caller authorization',async()=>{
  for(const access of [{role:'student'},{role:'grader'},{role:'auditor'},{role:'unlisted'},{role:'instructor',view_as:{uni:'a'}},{role:'instructor',read_only:true}])for(const action of ['export','record','purge']){const x=setup({access});assert.equal((await x.run({action,term_id:TERM})).status,403);assert.ok(!x.calls.includes('service-client'));}
  for(const action of ['export','record','purge']){const x=setup({denied:true});assert.equal((await x.run({action,term_id:TERM})).status,409);assert.ok(!x.calls.includes('service-client'));const invalid=setup();assert.equal((await invalid.run({action,term_id:'../other'})).status,400);}
});
