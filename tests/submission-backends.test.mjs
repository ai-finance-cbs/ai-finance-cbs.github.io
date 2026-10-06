import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../assets/materials/demo.js';
import { createBackend } from '../assets/materials/supabase.js';
import { checkSubmissionFile } from '../assets/materials/submission-core.js';
import { gradeCode } from '../assets/materials/class-core.js';
const KEY='b8403-demo-state-v3',USER='b8403-demo-user-v1';
let uploads;
const pdf=()=>new File(['%PDF-1.7\nDemo\n%%EOF'],'work.pdf',{type:'application/pdf'});
beforeEach(()=>{
  uploads=[];
  globalThis.XMLHttpRequest=class {
    constructor(){this.upload={};this.headers={};}
    open(method,url){this.method=method;this.url=url;}
    setRequestHeader(k,v){this.headers[k]=v;}
    send(file){uploads.push({method:this.method,url:this.url,headers:this.headers,file});queueMicrotask(()=>{this.upload.onprogress?.({lengthComputable:true,loaded:62,total:100});this.status=200;this.onload();});}
  };
  const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k) || null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4173/materials/?demo=1')};
  globalThis.FileReader=class {readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result=`data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});}};
});
test('demo archived access, roster write denial and file release keep term boundaries',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.setSessionTimes(1,'2027-03-15T13:00:00Z','2027-03-15T16:00:00Z');
  await d.uploadFile(pdf(),{week:0,title:'Hidden',released:false,auditor_visible:true,release_at:'2099-01-01'});
  await d.pickRole('student');assert.equal((await d.files()).length,0);
  await d.pickRole('instructor');const file=(await d.files())[0];await d.setFileRelease(file.id,false,'2020-01-01');
  await d.pickRole('auditor');assert.equal((await d.files()).length,1);assert.equal((await d.classData()).submissions.length,0);
  const state=JSON.parse(sessionStorage.getItem(KEY));state.terms[0].status='archived-readable';state.terms.push({id:'spring-2028',title:'Spring 2028',status:'active'});
  state.roster.push({term_id:'spring-2028',uni:'zz9999',name:'New Student'});
  state.items.push({...state.items[0],id:17,term_id:'spring-2028'});sessionStorage.setItem(KEY,JSON.stringify(state));
  await d.pickRole('instructor');assert.equal('replaceRoster' in d,false);
  await d.pickRole('student');assert.equal((await d.getAccess()).read_only,true);
  assert.equal((await d.classData()).term_id,'spring-2027');assert.equal((await d.classData()).grades.length,1);
  await assert.rejects(d.beginSubmission(1,pdf()),/read-only/);await assert.rejects(d.classData('spring-2028'),/Class access/);
  sessionStorage.setItem(USER,JSON.stringify({email:'zz9999@columbia.edu',uni:'zz9999'}));
  assert.equal((await d.classData()).grades.length,0);assert.equal(gradeCode((await d.classData()).items[0]),'M1');
});
test('browser file precheck rejects invalid signatures, types and sizes before allocating an upload',async()=>{
  await checkSubmissionFile(pdf());
  for(const file of [new File(['MZbinary'],'work.pdf',{type:'application/pdf'}),new File(['%PDF-'],'work.exe',{type:'application/pdf'}),{name:'work.pdf',type:'application/pdf',size:26*1024*1024}])await assert.rejects(checkSubmissionFile(file),/contents|25 MB/);
});
test('real browser adapter scopes term reads and routes upload finish and download through the file service',async()=>{
  const calls=[],pending={id:'pending-id',storage_path:'server-path.pdf'};
  const client={
    auth:{getSession:async()=>({data:{session:{access_token:'student-token'}}}),getUser:async()=>({data:{user:{email:'ab1234@columbia.edu',email_confirmed_at:'yes',app_metadata:{provider:'google'}}}})},
    rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:name==='get_access'?{role:'student',term_id:'spring-2027'}:name==='begin_submission'?pending:{}};},
    storage:{from:bucket=>({upload:async(path,file,options)=>{calls.push({bucket,path,options});return {};}})},
    functions:{invoke:async(name,{body})=>{calls.push({function:name,body});return {data:{url:'https://signed.example'}};}},
    from:table=>({select(){return this;},eq(column,value){calls.push({table,column,value});return this;},order(){return {data:[]};}}),
  };
  window.supabase={createClient:()=>client};const b=await createBackend({url:'https://db.example',key:'public'});
  await b.getAccess();await b.files();await b.sessions();await b.assignments();await b.classData('spring-2026');
  assert.ok(calls.some(c=>c.rpc==='class_data' && c.args.p_term==='spring-2026'));
  assert.ok(calls.filter(c=>c.table).every(c=>c.column==='term_id' && c.value==='spring-2027'));
  await b.submitFile(1,pdf());await b.submissionUrl('submission-id','on-time');await b.deleteSubmission('submission-id');
  assert.equal(uploads[0].method,'POST'); assert.equal(uploads[0].url,'https://db.example/storage/v1/object/submissions/server-path.pdf');
  assert.equal(uploads[0].headers['Content-Type'],'application/pdf'); assert.equal(uploads[0].headers['x-upsert'],'false');
  assert.deepEqual(calls.filter(c=>c.function),[
    {function:'submission-file',body:{action:'finish',pending_id:'pending-id'}},
    {function:'submission-file',body:{action:'download',id:'submission-id',version:'on-time'}},
    {function:'submission-file',body:{action:'delete',id:'submission-id'}},
  ]);
  assert.equal(calls.some(c=>c.rpc==='finish_submission'),false);
  const fake=createDemo();for(const method of ['gradeGroup','saveGrades','releaseItem','replaceRoster']){assert.equal(method in b,false);assert.equal(method in fake,false);}
  for(const method of ['terms','setSessionTimes','configureItem','beginSubmission','uploadSubmissionFile','finishSubmission','submitFile','submitLink','deleteSubmission','submissionUrl','sweepSubmissions','setFileRelease'])assert.equal(typeof fake[method],typeof b[method],method);
});

test('review 7/8: demo preview switches directly and normalizes Windows file MIME labels',async()=>{
  const d=createDemo();await d.pickRole('instructor');await d.setPreview('ab1234');
  assert.equal((await d.setPreview('cd5678')).view_as.uni,'cd5678');
  await assert.rejects(d.configureItem(1,{kind:'file',mode:'individual'}),/read-only/);await d.setPreview(null);
  await d.pickRole('student');
  for(const [name,type,expected] of [['work.zip','application/x-zip-compressed','application/zip'],['work.docx','','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const file=new File([new Uint8Array([0x50,0x4b,3,4])],name,{type});await checkSubmissionFile(file);
    await assert.rejects(d.beginSubmission(4,file),/CourseWorks/);
  }
});
test('review 8: real adapter uses extension-derived MIME for both begin and Storage upload',async()=>{
  const seen=[];window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'student-token'}}})},rpc:async(name,args)=>{seen.push(args);return {data:{id:'p',storage_path:'path'}};},storage:{from:()=>({upload:async(path,file,options)=>{seen.push(options);return {};}})}})};
  const b=await createBackend({url:'https://db.example',key:'public'});
  for(const [name,type,expected] of [['work.zip','application/x-zip-compressed','application/zip'],['work.docx','','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const file=new File([new Uint8Array([0x50,0x4b,3,4])],name,{type}),p=await b.beginSubmission(4,file);
    await b.uploadSubmissionFile(p,file);assert.equal(seen.at(-1).p_type,expected);assert.equal(uploads.at(-1).headers['Content-Type'],expected);
  }
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

test('a rejected XHR never calls finish and reports the original upload error',async()=>{
  const calls=[];
  globalThis.XMLHttpRequest=class {
    constructor(){this.upload={};}
    open(){}setRequestHeader(){}
    send(){queueMicrotask(()=>{this.status=403;this.responseText=JSON.stringify({message:'Storage permission denied.'});this.onload();});}
  };
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'student-token'}}})},rpc:async()=>({data:{id:'pending-id',storage_path:'server-path'}}),functions:{invoke:async()=>{calls.push('finish');return {data:{}};}}})};
  const b=await createBackend({url:'https://db.example',key:'public'});
  await assert.rejects(b.submitFile(4,pdf()),/Storage permission denied/);assert.deepEqual(calls,[]);
});

test('Phase G demo keeps notes private by role and term, and restricts group additions',async()=>{
  const d=createDemo();await d.pickRole('instructor');
  const term=(await d.getAccess()).term_id;
  await d.saveStudentNote(term,'ab1234','Private demo note');
  await assert.rejects(d.setGroupNote('demo-set','Working alone? Join a group.'),/CourseWorks/);
  await assert.rejects(d.addGroups('demo-set',3),/CourseWorks/);
  assert.equal((await d.classData()).groups.length,2);
  assert.equal((await d.classData()).student_notes,undefined);
  for(const role of ['grader','student','auditor']){
    await d.pickRole(role);await assert.rejects(d.studentNote(term,'ab1234'));
    await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'));
    await assert.rejects(d.setGroupNote('demo-set','Denied'));await assert.rejects(d.addGroups('demo-set',1));
    if(role==='grader')assert.equal((await d.studentProfile(term,'ab1234')).email,'ab1234@columbia.edu');
    else await assert.rejects(d.studentProfile(term,'ab1234'));
  }
  await d.pickRole('instructor');await d.setPreview('ab1234');
  await assert.rejects(d.studentNote(term,'ab1234'));await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'));
  await assert.rejects(d.addGroups('demo-set',1));await assert.rejects(d.setGroupNote('demo-set','Denied'));
  await d.setPreview(null);await d.openTerm('Fall 2027');
  assert.equal((await d.studentNote(term,'ab1234')).body,'Private demo note');
  await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'),/read-only/);
});
