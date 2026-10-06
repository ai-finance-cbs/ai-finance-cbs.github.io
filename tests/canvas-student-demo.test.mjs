import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
let b;
const TERM='spring-2027',KEY='b8403-demo-state-v3';
beforeEach(async()=>{
  const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4187/materials/')};b=createDemo();await b.pickRole('instructor');await b.syncCanvas(TERM);
});
const change=fn=>{const d=JSON.parse(sessionStorage.getItem(KEY));fn(d.canvas[TERM],d);sessionStorage.setItem(KEY,JSON.stringify(d));};
test('synthetic own projection is posted-only, stable across reads, and matches instructor preview',async()=>{
  change(d=>{Object.assign(d.submissions[0],{score:0,grade:'0'});Object.assign(d.submissions[1],{score:12345,grade:'HIDDEN'});});
  await b.pickRole('student');const d=await b.canvasStudentData(TERM);assert.equal(d.items[0].score,0);assert.equal(d.items[1].score,null);
  assert.deepEqual(d.groups[0].members,[{name:'Demo Student'},{name:'Second Student'}]);
  assert.ok(!JSON.stringify(d).includes('12345'));assert.ok(!JSON.stringify(d).includes('ab1234'));
  assert.deepEqual(await createDemo().canvasStudentData(TERM),d);
  await b.pickRole('instructor');await b.setPreview('ab1234');assert.deepEqual(await b.canvasStudentData(TERM),d);
  await b.setPreview('cd5678');assert.equal((await b.canvasStudentData(TERM)).items[0].status,'Late');
});
for(const role of ['instructor','grader','auditor','unlisted'])test(`demo ${role} cannot read personal student projection`,async()=>{
  await b.pickRole(role);await assert.rejects(b.canvasStudentData(TERM),/Student access/);
});
for(const role of ['instructor','grader','student','auditor','unlisted','preview'])test(`demo ${role} cannot mutate archived submissions or local groups`,async()=>{
  if(role==='preview')await b.setPreview('ab1234');else await b.pickRole(role);
  const before=sessionStorage.getItem(KEY);
  for(const method of ['beginSubmission','uploadSubmissionFile','finishSubmission','submitFile','submitLink','deleteSubmission','chooseGroup','createSet','updateSet','setGroupNote','addGroups'])await assert.rejects(b[method](),/CourseWorks/);
  assert.equal(sessionStorage.getItem(KEY),before);
});
test('demo failures and expired leases mask judgments and grades; fresh successful sync restores them',async()=>{
  change(d=>d.runs.unshift({id:'failed',status:'failed',started_at:new Date(Date.now()+1).toISOString()}));
  await b.pickRole('student');let d=await b.canvasStudentData(TERM);assert.equal(d.available,false);assert.deepEqual(d.groups,[]);assert.ok(d.items.every(i=>i.score===null&&i.status==='Status unavailable'));
  change(d=>d.runs=[]);await b.pickRole('instructor');await b.syncCanvas(TERM);await b.pickRole('student');assert.equal((await b.canvasStudentData(TERM)).available,true);
  change(d=>d.runs.unshift({status:'running',started_at:new Date(Date.now()-660000).toISOString()}));assert.equal((await b.canvasStudentData(TERM)).available,false);
});
test('demo respects enrollment matches and inactive states; closed or foreign terms deny access',async()=>{
  await b.pickRole('student');
  for(const fields of [{uni:null,match_status:'unmatched'},{uni:null,match_status:'ambiguous'},{enrollment_states:['inactive']}]){
    change(d=>Object.assign(d.enrollments[0],fields));const d=await b.canvasStudentData(TERM);assert.equal(d.available,false);assert.deepEqual(d.groups,[]);assert.ok(d.items.every(i=>i.url===null&&i.score===null));
    change(d=>Object.assign(d.enrollments[0],{uni:'ab1234',match_status:'matched',enrollment_states:['active']}));
  }
  await assert.rejects(b.canvasStudentData('foreign'),/Student access/);
  await b.pickRole('instructor');await b.openTerm('Spring 2028');await b.setPreview('ab1234',TERM);await assert.rejects(b.canvasStudentData('spring-2028'),/Student access/);
  change((_,d)=>d.terms.find(t=>t.id===TERM).status='closed');await assert.rejects(b.canvasStudentData(TERM),/Student access/);
});
