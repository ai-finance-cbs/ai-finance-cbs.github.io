import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
import {taskMapFixture} from './fixtures/task-map.mjs';
import {emptyTaskMap} from '../assets/materials/task-map-core.js';
const TERM='spring-2027',KEY='b8403-demo-state-v3'; let b;
beforeEach(async()=>{
  const values=new Map(); globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4178/materials/')}; b=createDemo();await b.pickRole('instructor');
  await b.saveAssignmentPage(TERM,'M2','Synthetic instructions');
  const data=JSON.parse(sessionStorage.getItem(KEY)); data.items.find(i=>i.code==='M2').due_at=new Date(Date.now()+86400000).toISOString(); sessionStorage.setItem(KEY,JSON.stringify(data));
  await b.pickRole('student'); await b.saveTaskMap(TERM,emptyTaskMap(),false);
});
test('demo draft, submission, identity, own reads, roster status, and preview match the database',async()=>{
  const value={...taskMapFixture(),uni:'cd5678',status:'draft'};const row=await b.saveTaskMap(TERM,value,true);
  assert.equal(row.uni,'ab1234');assert.equal(row.status,'submitted');assert.deepEqual((await createDemo().myTaskMap(TERM)).submission,row);
  await b.pickRole('instructor');const staff=await b.taskMapClass(TERM);assert.equal(staff.students.length,4);assert.equal(staff.students.filter(r=>r.submission).length,1);
  await b.setPreview('ab1234');assert.equal((await b.myTaskMap(TERM)).read_only,true);assert.deepEqual((await b.myTaskMap(TERM)).submission,row);
  await assert.rejects(b.saveTaskMap(TERM,value,true),/read-only/);await assert.rejects(b.taskMapClass(TERM));
  await b.setPreview('cd5678');assert.equal((await b.myTaskMap(TERM)).submission,null);
});
for(const role of ['student','instructor','grader','auditor','unlisted'])test(`demo ${role}: all three RPC boundaries`,async()=>{
  await b.pickRole(role);
  if(role==='student'){await b.myTaskMap(TERM);await b.saveTaskMap(TERM,taskMapFixture(),true);}
  else {await assert.rejects(b.myTaskMap(TERM));await assert.rejects(b.saveTaskMap(TERM,taskMapFixture(),true));}
  if(['instructor','grader'].includes(role))await b.taskMapClass(TERM);else await assert.rejects(b.taskMapClass(TERM));
});
test('demo rejects invalid payloads, late drafts, archives, and foreign terms',async()=>{
  const invalid=taskMapFixture();invalid.tasks[0].label='P';await assert.rejects(b.saveTaskMap(TERM,invalid,false));
  await assert.rejects(b.saveTaskMap(TERM,emptyTaskMap(),true));
  const data=JSON.parse(sessionStorage.getItem(KEY));data.items.find(i=>i.code==='M2').due_at=new Date(Date.now()-1000).toISOString();sessionStorage.setItem(KEY,JSON.stringify(data));
  await assert.rejects(b.saveTaskMap(TERM,taskMapFixture(),false),/closed/);
  await b.pickRole('instructor');await b.openTerm('Spring 2028');await b.pickRole('student');
  assert.equal((await b.myTaskMap(TERM)).read_only,true);await assert.rejects(b.saveTaskMap(TERM,taskMapFixture(),false),/read-only/);
  await assert.rejects(b.myTaskMap('spring-2028'));await assert.rejects(b.myTaskMap('unknown'));
});
