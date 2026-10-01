import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/submission-file/handler.js';
import { validSubmissionBytes, TYPES, MAX_BYTES } from '../supabase/functions/_shared/submission-files.js';
const ID='11111111-0000-0000-0000-000000000001', PATH=`spring-2027/1/aa1001/${ID}.pdf`;
const pdf=new TextEncoder().encode('%PDF-1.7\nDemo\n%%EOF');
// Minimal ZIP records with empty entries. This tests the directory parser without external tools.
function zip(names) {
  const locals=[],central=[];let offset=0;
  for(const name of names) {
    const n=Buffer.from(name),local=Buffer.alloc(30+n.length),dir=Buffer.alloc(46+n.length);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(n.length,26);n.copy(local,30);
    dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);n.copy(dir,46);
    locals.push(local);central.push(dir);offset+=local.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
function setup(options={}) {
  const calls=[],access={role:'student',term_id:'spring-2027',...options.access};
  const pending={id:ID,term_id:'spring-2027',storage_path:PATH,file_name:'work.pdf',file_size:pdf.length,mime_type:TYPES.pdf,expires_at:new Date(Date.now()+60000).toISOString(),...options.pending};
  const query=table=>({select(fields){calls.push({select:table,fields});return this;},eq(field,id){assert.equal(field,'id');assert.equal(id,ID);return this;},async single(){
    if(options.hidden)return {error:{message:'hidden'}};
    return {data:table==='pending_uploads'?pending:{id:ID,storage_path:PATH,on_time_path:'server-on-time.pdf'}};
  }});
  const caller={auth:{getUser:async()=>options.invalid?{error:{}}:{data:{user:{id:'caller'}}}},from:query,
    rpc:async(name,args)=>{
      calls.push({caller:name,args});
      if(name==='get_access')return {data:access};
      assert.equal(name,'finish_submission');assert.deepEqual(args,{p_pending:ID,p_receipt:'server-receipt'});
      return options.finishError?{error:{message:options.finishError}}:{data:{submission:{id:ID,storage_path:PATH},replaced_paths:options.replaced || []}};
    }};
  const server={rpc:async(name,args)=>{
    calls.push({server:name,args});
    if(name==='submission_sweep_candidates')return {data:options.expired || []};
    if(name==='confirm_submission_upload')return {data:'server-receipt'};
    if(name==='reject_submission_upload')return {data:options.alreadyCommitted?[]:[PATH]};
    assert.fail(name);
  },storage:{from:bucket=>{
    assert.equal(bucket,'submissions');return {
      download:async path=>{calls.push({download:path});return options.absent?{error:{}}:{data:options.file || new Blob([pdf])};},
      remove:async paths=>{calls.push({remove:paths});return {error:options.removeError || null};},
      createSignedUrl:async(path,ttl,opts)=>{calls.push({signed:path,ttl,opts});return {data:{signedUrl:'https://files.example/signed'}};},
    };
  }}};
  const handler=createHandler((_url,key)=>{if(key==='server'){calls.push('service-client');return server;}return caller;},name=>({SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server'})[name]);
  const request=(body,headers={})=>new Request('https://function.example/submission-file',{method:'POST',headers:{authorization:'Bearer token',origin:'http://127.0.0.1:4173','content-type':'application/json',...headers},body:JSON.stringify(body)});
  return {calls,run:body=>handler(request(body)),handler,request};
}
test('all five types require matching extension, MIME, and real PDF or ZIP directory bytes',()=>{
  assert.ok(validSubmissionBytes(pdf,'work.PDF',TYPES.pdf));
  for(const [ext,main] of [['docx','word/document.xml'],['xlsx','xl/workbook.xml'],['pptx','ppt/presentation.xml']]) {
    assert.ok(validSubmissionBytes(zip(['[Content_Types].xml',main]),'work.'+ext,TYPES[ext]));
    assert.equal(validSubmissionBytes(zip(['unrelated.txt']),'work.'+ext,TYPES[ext]),false);
  }
  assert.ok(validSubmissionBytes(zip(['a.txt']),'work.zip',TYPES.zip));
  for(const content of [new Uint8Array(),new TextEncoder().encode('MZ executable'),new Uint8Array([0x50,0x4b,3,4])]) {
    assert.equal(validSubmissionBytes(content,'work.pdf',TYPES.pdf),false);
    assert.equal(validSubmissionBytes(content,'work.docx',TYPES.docx),false);
  }
  assert.equal(validSubmissionBytes(pdf,'work.exe',TYPES.pdf),false);
  assert.equal(validSubmissionBytes(pdf,'work.pdf',TYPES.zip),false);
  const broken=zip(['a']);broken.writeUInt32LE(0xffffffff,broken.length-6);
  assert.equal(validSubmissionBytes(broken,'work.zip',TYPES.zip),false);
});
test('owner and grader downloads use caller-scoped metadata and 300-second attachment URLs',async()=>{
  for(const role of ['student','grader','instructor'])for(const version of ['current','on-time']) {
    const x=setup({access:{role}}),res=await x.run({action:'download',id:ID,version,path:'attacker.pdf',expiresIn:9999});
    assert.equal(res.status,200);assert.equal((await res.json()).expiresIn,300);
    assert.deepEqual(x.calls.at(-1),{signed:version==='current'?PATH:'server-on-time.pdf',ttl:300,opts:{download:true}});
    assert.equal(res.headers.get('cache-control'),'no-store');
  }
  const peer=setup({hidden:true});assert.equal((await peer.run({action:'download',id:ID})).status,404);
  assert.ok(!peer.calls.includes('service-client'));
});
test('finish verifies the uploaded object then calls the caller RPC and deletes only returned replacement paths',async()=>{
  const x=setup({expired:['expired.pdf'],replaced:['old.pdf']}),res=await x.run({action:'finish',pending_id:ID,path:'attacker.pdf',replaced_paths:['victim.pdf']});
  assert.equal(res.status,200);assert.deepEqual(x.calls.filter(c=>c.remove),[{remove:['expired.pdf']},{remove:['old.pdf']}]);
  const verify=x.calls.findIndex(c=>c.server==='confirm_submission_upload'),finish=x.calls.findIndex(c=>c.caller==='finish_submission');
  assert.ok(verify>0 && finish>verify);assert.equal(x.calls.some(c=>c.server==='finish_submission'),false);
  assert.deepEqual(x.calls.find(c=>c.server==='confirm_submission_upload').args,{p_term:'spring-2027',p_pending:ID,p_size:pdf.length,p_type:TYPES.pdf});
});
test('missing objects never finish; forged magic bytes and over-size objects are rejected and removed',async()=>{
  const missing=setup({absent:true});assert.equal((await missing.run({action:'finish',pending_id:ID})).status,409);
  assert.equal(missing.calls.some(c=>c.caller==='finish_submission'),false);
  for(const file of [new Blob([new Uint8Array(pdf.length).fill(77)]),{size:MAX_BYTES+1}]) {
    const x=setup({file}),res=await x.run({action:'finish',pending_id:ID});assert.equal(res.status,400);
    assert.equal(x.calls.some(c=>c.caller==='finish_submission'),false);
    assert.deepEqual(x.calls.filter(c=>c.remove),[{remove:[PATH]}]);
  }
});
test('a failed or duplicate finish deletes only paths confirmed unreferenced by the database',async()=>{
  for(const alreadyCommitted of [false,true]) {
    const x=setup({finishError:'Graded, locked.',alreadyCommitted});assert.equal((await x.run({action:'finish',pending_id:ID})).status,409);
    assert.ok(x.calls.some(c=>c.server==='reject_submission_upload'));
    assert.deepEqual(x.calls.filter(c=>c.remove),alreadyCommitted?[]:[{remove:[PATH]}]);
  }
  const x=setup({replaced:['old.pdf'],removeError:{message:'temporary'}}),res=await x.run({action:'finish',pending_id:ID});
  assert.equal(res.status,200);assert.equal((await res.json()).cleanup_pending,true);
});
test('expired sweeps require instructor access and use server-selected paths',async()=>{
  const x=setup({access:{role:'instructor'},expired:['expired.pdf','superseded.pdf']});
  assert.equal((await x.run({action:'sweep',paths:['victim.pdf']})).status,200);
  assert.deepEqual(x.calls.filter(c=>c.remove),[{remove:['expired.pdf','superseded.pdf']}]);
  assert.equal((await x.run({action:'purge'})).status,409,'Export and close belong to Phase C.');
  const expired=setup({pending:{expires_at:'2020-01-01'}});
  assert.equal((await expired.run({action:'finish',pending_id:ID})).status,409);
  assert.equal(expired.calls.some(c=>c.download),false);
});
test('role, preview, archived, origin, and identity denials never reach privileged storage',async()=>{
  const denied=[
    ...['grader','instructor','auditor','unlisted'].map(role=>[{role},'finish']),
    ...['student','grader','auditor','unlisted'].flatMap(role=>['sweep','purge'].map(action=>[{role},action])),
    [{role:'auditor'},'download'],[{role:'student',view_as:{uni:'aa1001'}},'finish'],
    [{role:'student',read_only:true},'finish'],[{role:'instructor',read_only:true},'sweep'],
  ];
  for(const [access,action] of denied){const x=setup({access});assert.equal((await x.run({action,id:ID,pending_id:ID})).status,403);assert.ok(!x.calls.includes('service-client'));}
  const invalid=setup({invalid:true});assert.equal((await invalid.run({action:'finish',pending_id:ID})).status,401);
  const x=setup();assert.equal((await x.handler(x.request({action:'finish',pending_id:ID},{origin:'https://evil.example'}))).status,403);
  assert.equal((await x.run({action:'download',id:'../private'})).status,400);
});

test('review 6: a PDF needs both its header and an end marker within the final 1 KB',async()=>{
  for(const content of ['%PDF-1.7\ntruncated','%PDF-1.7\n%%EOF'+'x'.repeat(1024)]) {
    const bytes=new TextEncoder().encode(content);assert.equal(validSubmissionBytes(bytes,'work.pdf',TYPES.pdf),false);
    const x=setup({file:new Blob([bytes]),pending:{file_size:bytes.length}});
    assert.equal((await x.run({action:'finish',pending_id:ID})).status,400);
    assert.deepEqual(x.calls.filter(c=>c.remove),[{remove:[PATH]}]);
  }
  assert.ok(validSubmissionBytes(new TextEncoder().encode('%PDF-1.7\n%%EOF'+' '.repeat(1019)),'work.pdf',TYPES.pdf));
});
test('review 12: every privileged submission RPC receives the trusted term explicitly',async()=>{
  const x=setup({finishError:'Graded, locked.'});await x.run({action:'finish',pending_id:ID,term_id:'attacker-term'});
  for(const call of x.calls.filter(c=>c.server))assert.equal(call.args.p_term,'spring-2027');
  const instructor=setup({access:{role:'instructor'}});await instructor.run({action:'sweep',term_id:'attacker-term'});
  assert.deepEqual(instructor.calls.find(c=>c.server).args,{p_term:'spring-2027'});
});
