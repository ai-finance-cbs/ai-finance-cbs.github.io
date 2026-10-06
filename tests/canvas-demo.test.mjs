import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
let b;
beforeEach(async()=>{
  const data=new Map();globalThis.sessionStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4173/materials/settings/?fakeauth=instructor')};b=createDemo();await b.pickRole('instructor');
});
test('demo mappings and sync persist without changing student records or copying Canvas IDs at rollover',async()=>{
  await b.pickRole('student');const before=await b.classData();await b.pickRole('instructor');const data=await b.canvasData('spring-2027');
  await b.saveCanvasMapping('spring-2027',{site_key:'Q6',kind:'quiz',week:6,canvas_assignment_id:data.assignments.at(-1).id});
  await b.syncCanvas('spring-2027');assert.ok((await createDemo().canvasData('spring-2027')).mappings.some(m=>m.site_key==='Q6'));
  await b.pickRole('student');assert.deepEqual(await b.classData(),before);assert.ok(!JSON.stringify(before).includes('canvas'));
  await b.pickRole('instructor');await b.openTerm('Spring 2028');assert.equal((await b.canvasData('spring-2028')).course,null);
  await assert.rejects(b.syncCanvas('spring-2027'),/active term/);
});
for(const role of ['grader','student','auditor','unlisted','preview'])test(`demo ${role} boundaries match staff-only Phase A`,async()=>{
  if(role==='preview')await b.setPreview('ab1234');else await b.pickRole(role);
  if(role==='grader')assert.ok((await b.canvasData('spring-2027')).submissions.length);else await assert.rejects(b.canvasData('spring-2027'),/Staff/);
  await assert.rejects(b.syncCanvas('spring-2027'),/Staff|Instructor/);
  await assert.rejects(b.saveCanvasCourse('spring-2027',240316,true),/Staff|Instructor/);
  await assert.rejects(b.saveCanvasMapping('spring-2027',{site_key:'M1',kind:'milestone',week:1,canvas_assignment_id:'100'}),/Staff|Instructor/);
});

test('demo course reset clears copied data and mappings, preserves history, and does not change student records',async()=>{
  await b.syncCanvas('spring-2027');const before=await b.canvasData('spring-2027'),legacy=await b.classData();
  await b.saveCanvasCourse('spring-2027',240315);assert.deepEqual(await b.canvasData('spring-2027'),before);
  await assert.rejects(b.saveCanvasCourse('spring-2027',240316),/Confirm the Canvas/);
  assert.deepEqual(await b.canvasData('spring-2027'),before);
  await b.saveCanvasCourse('spring-2027',240316,true);const reset=await createDemo().canvasData('spring-2027');
  assert.equal(reset.course.course_id,'240316');assert.equal(reset.course.generation,null);assert.equal(reset.course.last_synced_at,null);
  for(const key of ['assignments','submissions','enrollments','groups','group_members','mappings'])assert.deepEqual(reset[key],[]);
  assert.equal(reset.runs[0].status,'reset');assert.equal(reset.runs[0].counts.submissions,before.submissions.length);
  assert.equal(reset.runs.length,before.runs.length+1);assert.deepEqual(await b.classData(),legacy);
  await b.openTerm('Spring 2028');await assert.rejects(b.saveCanvasCourse('spring-2027',240317,true),/active term/);
  await b.saveCanvasCourse('spring-2028',240315);await b.saveCanvasCourse('spring-2028',240317,true);
  assert.deepEqual(await b.canvasData('spring-2027'),reset);
});

test('demo reset blocks a live lease and expires an abandoned lease',async()=>{
  await b.syncCanvas('spring-2027');const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));
  d.canvas['spring-2027'].runs.unshift({id:'live',status:'running',started_at:new Date().toISOString()});sessionStorage.setItem(key,JSON.stringify(d));
  const before=await b.canvasData('spring-2027');await assert.rejects(b.saveCanvasCourse('spring-2027',240316,true),/current sync/);
  assert.deepEqual(await b.canvasData('spring-2027'),before);
  d.canvas['spring-2027'].runs[0].started_at=new Date(Date.now()-660000).toISOString();sessionStorage.setItem(key,JSON.stringify(d));
  await b.saveCanvasCourse('spring-2027',240316,true);const reset=await b.canvasData('spring-2027');
  assert.equal(reset.runs[0].status,'reset');assert.equal(reset.runs[1].status,'failed');
});
