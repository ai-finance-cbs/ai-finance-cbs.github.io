import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../assets/materials/demo.js';
import { createBackend } from '../assets/materials/supabase.js';
import { gradeCode } from '../assets/materials/class-core.js';
const KEY='b8403-demo-state-v3',USER='b8403-demo-user-v1';
const pdf=()=>new File(['%PDF-1.7\nDemo\n%%EOF'],'work.pdf',{type:'application/pdf'});
beforeEach(()=>{
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
  assert.equal('beginSubmission' in d,false);await assert.rejects(d.classData('spring-2028'),/Class access/);
  sessionStorage.setItem(USER,JSON.stringify({email:'zz9999@columbia.edu',uni:'zz9999'}));
  assert.equal((await d.classData()).grades.length,0);assert.equal(gradeCode((await d.classData()).items[0]),'M1');
});
test('real browser adapter scopes term reads and routes archive downloads through the file service',async()=>{
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
  await b.submissionUrl('submission-id','on-time');
  assert.deepEqual(calls.filter(c=>c.function),[
    {function:'submission-file',body:{action:'download',id:'submission-id',version:'on-time'}},
  ]);
  assert.equal(calls.some(c=>c.rpc==='finish_submission'),false);
  const fake=createDemo();for(const method of ['gradeGroup','saveGrades','releaseItem','replaceRoster','beginSubmission','uploadSubmissionFile','finishSubmission','submitFile','submitLink','deleteSubmission','createSet','updateSet','chooseGroup','setGroupNote','addGroups','configureItem','sweepSubmissions','setSessionDate']){assert.equal(method in b,false);assert.equal(method in fake,false);}
  for(const method of ['terms','setSessionTimes','submissionUrl','setFileRelease'])assert.equal(typeof fake[method],typeof b[method],method);
});

test('demo preview switches directly and still blocks private note writes',async()=>{
  const b=createDemo();await b.pickRole('instructor');await b.setPreview('ab1234');
  assert.equal((await b.setPreview('cd5678')).view_as.uni,'cd5678');
  await assert.rejects(b.saveStudentNote('spring-2027','cd5678','Denied'),/Staff access required/);
  await b.setPreview(null);
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

test('Phase G demo keeps notes private by role and term, after retiring group writes',async()=>{
  const d=createDemo();await d.pickRole('instructor');
  const term=(await d.getAccess()).term_id;
  await d.saveStudentNote(term,'ab1234','Private demo note');
  assert.equal((await d.classData()).groups.length,2);
  assert.equal((await d.classData()).student_notes,undefined);
  for(const role of ['grader','student','auditor']){
    await d.pickRole(role);await assert.rejects(d.studentNote(term,'ab1234'));
    await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'));
    if(role==='grader')assert.equal((await d.studentProfile(term,'ab1234')).email,'ab1234@columbia.edu');
    else await assert.rejects(d.studentProfile(term,'ab1234'));
  }
  await d.pickRole('instructor');await d.setPreview('ab1234');
  await assert.rejects(d.studentNote(term,'ab1234'));await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'));
  await d.setPreview(null);await d.openTerm('Fall 2027');
  assert.equal((await d.studentNote(term,'ab1234')).body,'Private demo note');
  await assert.rejects(d.saveStudentNote(term,'ab1234','Denied'),/read-only/);
});
