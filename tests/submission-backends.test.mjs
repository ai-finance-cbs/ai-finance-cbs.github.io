import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../assets/materials/demo.js';
import { createBackend } from '../assets/materials/supabase.js';
import { checkSubmissionFile } from '../assets/materials/submission-core.js';
import { gradeCode } from '../assets/materials/class-core.js';
const KEY='b8403-demo-state-v3',USER='b8403-demo-user-v1';
const pdf=()=>new File(['%PDF-1.7\nDemo\n%%EOF'],'work.pdf',{type:'application/pdf'});
beforeEach(()=>{
  const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k) || null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4173/materials/?demo=1')};
  globalThis.FileReader=class {readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result=`data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});}};
});
test('demo file submission, late replacement, release, comments and lock follow the real backend contract',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.saveGrades([{uni:'ab1234',item_id:1,score:null}]);await d.pickRole('student');
  const first=await d.submitFile(1,pdf());assert.equal(first.submission.late,false);
  assert.equal(first.submission.member_unis,undefined);assert.equal(first.submission.submitted_by,undefined);
  await d.pickRole('instructor');
  await d.configureItem(1,{kind:'file',mode:'individual',group_set_id:null,due_at:'2020-01-01T00:00:00Z'});
  await d.pickRole('student');const late=await d.submitFile(1,pdf());
  assert.equal(late.submission.late,true);assert.equal(late.submission.on_time_path,first.submission.storage_path);
  assert.equal((await d.classData()).submissions[0].status,'Late');
  await d.pickRole('grader');await d.saveGrades([{uni:'ab1234',item_id:1,score:7,comment:'Explain the assumption.'}]);
  await d.saveGrades([{uni:'ab1234',item_id:1,score:8}]);
  assert.equal((await d.classData()).grades.find(g=>g.uni==='ab1234' && g.item_id===1).comment,'Explain the assumption.');
  await d.pickRole('instructor');await d.releaseItem(1,false);
  await d.pickRole('student');assert.equal((await d.classData()).grades.length,0);
  await assert.rejects(d.beginSubmission(1,pdf()),/Graded, locked/);
  await d.pickRole('instructor');await d.releaseItem(1,true);
  await d.pickRole('student');assert.equal((await d.classData()).grades[0].comment,'Explain the assumption.');
  await d.pickRole('grader');await d.saveGrades([{uni:'ab1234',item_id:1,score:null}]);
  await d.pickRole('student');assert.ok(await d.beginSubmission(1,pdf()));
});
test('demo group links, group grading, current membership and earliest due date match SQL rules',async()=>{
  const d=createDemo();await d.pickRole('instructor');
  await d.configureItem(6,{kind:'link',mode:'group',group_set_id:'demo-set',due_at:null});
  await d.pickRole('student');await assert.rejects(d.submitLink(6,'https://example.test/demo'),/Join a group first/);
  await d.chooseGroup('demo-set','demo-group-1');
  for(const link of ['http://example.test','javascript:alert(1)'])await assert.rejects(d.submitLink(6,link),/https/);
  await d.submitLink(6,'https://example.test/demo');
  const student=(await d.classData()).submissions[0];assert.equal(student.member_unis,undefined);
  await d.pickRole('grader');assert.equal((await d.classData()).groups.length,2);
  await d.gradeGroup(6,'demo-group-1',20,'Group comment.');
  assert.equal((await d.classData()).grades.filter(g=>g.item_id===6).length,2);
  await assert.rejects(d.releaseItem(6,true),/Instructor/);
  await d.pickRole('instructor');await d.configureItem(6,{kind:'link',mode:'group',group_set_id:'demo-set',due_at:'2020-01-01'});
  await d.pickRole('student');await assert.rejects(d.chooseGroup('demo-set',null),/closed/);
  await d.pickRole('instructor');await d.chooseGroup('demo-set','demo-group-2','ab1234');
  assert.equal((await d.classData()).submissions[0].membership_changed,true);
  await d.setPreview('ab1234');await assert.rejects(d.submitLink(6,'https://example.test/demo'),/read-only/);await d.setPreview(null);
});
test('demo archived access, roster replacement and file release keep term boundaries',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.setSessionTimes(1,'2027-03-15T13:00:00Z','2027-03-15T16:00:00Z');
  await d.uploadFile(pdf(),{week:0,title:'Hidden',released:false,auditor_visible:true,release_at:'2099-01-01'});
  await d.pickRole('student');assert.equal((await d.files()).length,0);
  await d.pickRole('instructor');const file=(await d.files())[0];await d.setFileRelease(file.id,false,'2020-01-01');
  await d.pickRole('auditor');assert.equal((await d.files()).length,1);assert.equal((await d.classData()).submissions.length,0);
  const state=JSON.parse(sessionStorage.getItem(KEY));state.terms[0].status='archived-readable';state.terms.push({id:'spring-2028',title:'Spring 2028',status:'active'});
  state.roster.push({term_id:'spring-2028',uni:'zz9999',name:'New Student'});
  state.items.push({...state.items[0],id:17,term_id:'spring-2028'});sessionStorage.setItem(KEY,JSON.stringify(state));
  await d.pickRole('instructor');await d.replaceRoster([{uni:'zz9999',name:'New Student updated'}]);
  await d.pickRole('student');assert.equal((await d.getAccess()).read_only,true);
  assert.equal((await d.classData()).term_id,'spring-2027');assert.equal((await d.classData()).grades.length,1);
  await assert.rejects(d.beginSubmission(1,pdf()),/read-only/);await assert.rejects(d.classData('spring-2028'),/Class access/);
  sessionStorage.setItem(USER,JSON.stringify({email:'zz9999@columbia.edu',uni:'zz9999'}));
  assert.equal((await d.classData()).grades.length,0);assert.equal(gradeCode((await d.classData()).items[0]),'M1');
});
test('demo pending uploads expire and supersede without counting as submissions or blocking mode changes',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.saveGrades([{uni:'ab1234',item_id:1,score:null}]);await d.pickRole('student');const first=await d.beginSubmission(1,pdf()),second=await d.beginSubmission(1,pdf());
  await assert.rejects(d.finishSubmission(first.id),/superseded/);
  await assert.rejects(d.finishSubmission(second.id),/Upload the file/);assert.equal((await d.classData()).submissions.length,0);
  await d.pickRole('instructor');await d.configureItem(1,{kind:'link',mode:'individual',group_set_id:null,due_at:null});
  const state=JSON.parse(sessionStorage.getItem(KEY));state.pending_uploads[0].expires_at='2020-01-01';sessionStorage.setItem(KEY,JSON.stringify(state));
  assert.equal((await d.sweepSubmissions()).removed,1);
});
test('browser file precheck rejects invalid signatures, types and sizes before allocating an upload',async()=>{
  await checkSubmissionFile(pdf());
  for(const file of [new File(['MZbinary'],'work.pdf',{type:'application/pdf'}),new File(['%PDF-'],'work.exe',{type:'application/pdf'}),{name:'work.pdf',type:'application/pdf',size:26*1024*1024}])await assert.rejects(checkSubmissionFile(file),/contents|25 MB/);
});
test('real browser adapter scopes term reads and routes upload finish and download through the file service',async()=>{
  const calls=[],pending={id:'pending-id',storage_path:'server-path.pdf'};
  const client={
    auth:{getSession:async()=>({data:{session:{}}}),getUser:async()=>({data:{user:{email:'ab1234@columbia.edu',email_confirmed_at:'yes',app_metadata:{provider:'google'}}}})},
    rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:name==='get_access'?{role:'student',term_id:'spring-2027'}:name==='begin_submission'?pending:{}};},
    storage:{from:bucket=>({upload:async(path,file,options)=>{calls.push({bucket,path,options});return {};}})},
    functions:{invoke:async(name,{body})=>{calls.push({function:name,body});return {data:{url:'https://signed.example'}};}},
    from:table=>({select(){return this;},eq(column,value){calls.push({table,column,value});return this;},order(){return {data:[]};}}),
  };
  window.supabase={createClient:()=>client};const b=await createBackend({url:'https://db.example',key:'public'});
  await b.getAccess();await b.files();await b.sessions();await b.assignments();await b.classData('spring-2026');
  assert.ok(calls.some(c=>c.rpc==='class_data' && c.args.p_term==='spring-2026'));
  assert.ok(calls.filter(c=>c.table).every(c=>c.column==='term_id' && c.value==='spring-2027'));
  await b.submitFile(1,pdf());await b.submissionUrl('submission-id','on-time');await b.gradeGroup(2,'group-id',8,'Comment');
  assert.deepEqual(calls.find(c=>c.bucket),{bucket:'submissions',path:'server-path.pdf',options:{contentType:'application/pdf',cacheControl:'0',upsert:false}});
  assert.deepEqual(calls.filter(c=>c.function),[
    {function:'submission-file',body:{action:'finish',pending_id:'pending-id'}},
    {function:'submission-file',body:{action:'download',id:'submission-id',version:'on-time'}},
  ]);
  assert.equal(calls.some(c=>c.rpc==='finish_submission'),false);
  const fake=createDemo();for(const method of ['terms','setSessionTimes','configureItem','beginSubmission','uploadSubmissionFile','finishSubmission','submitFile','submitLink','submissionUrl','sweepSubmissions','gradeGroup','setFileRelease'])assert.equal(typeof fake[method],typeof b[method],method);
});

test('review 7/8: demo preview switches directly and normalizes Windows file MIME labels',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.setPreview('ab1234');
  assert.equal((await d.setPreview('cd5678')).view_as.uni,'cd5678');
  await assert.rejects(d.configureItem(1,{kind:'file',mode:'individual'}),/read-only/);await d.setPreview(null);
  await d.pickRole('student');
  for(const [name,type,expected] of [['work.zip','application/x-zip-compressed','application/zip'],['work.docx','','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const file=new File([new Uint8Array([0x50,0x4b,3,4])],name,{type});await checkSubmissionFile(file);
    const pending=await d.beginSubmission(4,file);assert.equal(pending.mime_type,expected);
    await d.uploadSubmissionFile(pending,file);
  }
});
test('review 8: real adapter uses extension-derived MIME for both begin and Storage upload',async()=>{
  const seen=[];window.supabase={createClient:()=>({rpc:async(name,args)=>{seen.push(args);return {data:{id:'p',storage_path:'path'}};},storage:{from:()=>({upload:async(path,file,options)=>{seen.push(options);return {};}})}})};
  const b=await createBackend({url:'https://db.example',key:'public'});
  for(const [name,type,expected] of [['work.zip','application/x-zip-compressed','application/zip'],['work.docx','','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const file=new File([new Uint8Array([0x50,0x4b,3,4])],name,{type}),p=await b.beginSubmission(4,file);
    await b.uploadSubmissionFile(p,file);assert.equal(seen.at(-2).p_type,expected);assert.equal(seen.at(-1).contentType,expected);
  }
});
test('review 1/3/4/5: demo prevents group hopping and early grades while limiting student metadata',async()=>{
  const d=createDemo();await d.pickRole('student');await assert.rejects(d.beginSubmission(1,pdf()),/Graded, locked/);
  await d.pickRole('instructor');await d.configureItem(2,{kind:'file',mode:'group',group_set_id:'demo-set',due_at:null});
  await d.chooseGroup('demo-set','demo-group-1','ab1234');await d.pickRole('student');await d.submitFile(2,pdf());
  await assert.rejects(d.chooseGroup('demo-set',null),/submitted work/);
  await d.pickRole('instructor');await d.chooseGroup('demo-set','demo-group-2','ab1234');await d.pickRole('student');
  await assert.rejects(d.chooseGroup('demo-set','demo-group-1'),/submitted work/);
  const snapshot=await d.classData();assert.ok(snapshot.submission_items.every(i=>i.kind!=='none' && !('quiz_week' in i) && !('max_points' in i)));
  assert.equal(snapshot.submission_items.find(i=>i.id===1).locked,true);
  await d.pickRole('instructor');await d.chooseGroup('demo-set','demo-group-1','ab1234');await d.pickRole('student');
  assert.equal('graded_at' in (await d.classData()).submissions[0],false);
});

test('review 2: demo stores object time, applies upload grace, and keeps on-time links explicitly false',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.configureItem(4,{kind:'file',mode:'individual',group_set_id:null,due_at:'2020-01-01T09:00Z'});
  await d.pickRole('student');const p=await d.beginSubmission(4,pdf());assert.ok(new Date(p.expires_at)-new Date(p.started_at)<=900001);await d.uploadSubmissionFile(p,pdf());
  const state=JSON.parse(sessionStorage.getItem(KEY));state.pending_uploads[0].started_at='2020-01-01T08:59Z';state.pending_uploads[0].object_created_at='2020-01-01T09:20Z';sessionStorage.setItem(KEY,JSON.stringify(state));
  const result=await d.finishSubmission(p.id);assert.equal(result.submission.late,true);assert.equal(result.submission.object_created_at,'2020-01-01T09:20Z');
  await d.pickRole('instructor');await d.configureItem(1,{kind:'link',mode:'individual',group_set_id:null,due_at:'2099-01-01'});await d.saveGrades([{uni:'ab1234',item_id:1,score:null}]);
  await d.pickRole('student');assert.equal((await d.submitLink(1,'https://example.test/demo')).submission.late,false);
});

test('file category is explicit in demo uploads and does not change titles or access rules',async()=>{
  const b=createDemo();await b.pickRole('instructor');
  await b.uploadFile(pdf(),{week:3,title:'Exercise',category:'in_class',released:true,auditor_visible:true});
  await b.uploadFile(pdf(),{week:3,title:'In-class: note title',category:'notes',released:true});
  const files=await b.files();assert.equal(files[0].category,'in_class');assert.equal(files[0].title,'Exercise');
  assert.equal(files[1].category,'notes');assert.equal(files[1].title,'In-class: note title');
  await assert.rejects(b.uploadFile(pdf(),{week:1,title:'Invalid',category:'other'}),/Choose/);
  await b.pickRole('auditor');assert.deepEqual((await b.classData()).files.map(f=>f.category),['in_class']);
  await assert.rejects(b.uploadFile(pdf(),{week:3,title:'No',category:'in_class'}),/access/);
});
