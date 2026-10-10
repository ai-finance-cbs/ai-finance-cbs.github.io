import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
import {emptySurvey} from '../assets/materials/survey-core.js';
import {surveyFixture} from './fixtures/survey.mjs';
const TERM='spring-2027',KEY='b8403-demo-state-v3';let b;
const change=fn=>{const d=JSON.parse(sessionStorage.getItem(KEY));fn(d);sessionStorage.setItem(KEY,JSON.stringify(d));};
beforeEach(async()=>{
  const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4188/materials/')};b=createDemo();await b.pickRole('instructor');await b.syncCanvas(TERM);
  change(d=>d.canvas[TERM].submissions.forEach(s=>s.cached_due_at=new Date(Date.now()+86400000).toISOString()));await b.pickRole('student');
});
test('demo prefill, own identity, draft persistence, resubmission and preview match the database',async()=>{
  let own=await b.mySurvey(TERM);assert.equal(own.roster_name,'Demo Student');assert.equal(own.uni,'ab1234');
  await b.saveSurvey(TERM,{...emptySurvey('Edited name'),uni:'cd5678'},false);assert.equal((await createDemo().mySurvey(TERM)).submission.answers.full_name,'Edited name');
  await b.saveSurvey(TERM,surveyFixture(),true);own=await b.mySurvey(TERM);assert.equal(own.submission.status,'submitted');assert.equal(own.submission.uni,'ab1234');
  await b.pickRole('instructor');assert.equal((await b.surveyClass(TERM)).students.filter(s=>s.submission).length,1);
  await b.setPreview('ab1234');assert.equal((await b.mySurvey(TERM)).read_only,true);await assert.rejects(b.saveSurvey(TERM,surveyFixture(),true),/read-only/);await assert.rejects(b.surveyClass(TERM));
  await b.setPreview('cd5678');assert.equal((await b.mySurvey(TERM)).submission,null);
});
for(const role of ['student','instructor','grader','auditor','unlisted'])test(`demo ${role}: survey RPC permissions`,async()=>{
  await b.pickRole(role);if(role==='student'){await b.mySurvey(TERM);await b.saveSurvey(TERM,surveyFixture(),true);}else{await assert.rejects(b.mySurvey(TERM));await assert.rejects(b.saveSurvey(TERM,surveyFixture(),true));}
  if(['instructor','grader'].includes(role))await b.surveyClass(TERM);else await assert.rejects(b.surveyClass(TERM));
});
test('demo enforces individual Canvas deadlines, missing dates, validation, and archived terms',async()=>{
  await assert.rejects(b.saveSurvey(TERM,emptySurvey(),true));change(d=>{d.items.find(i=>i.code==='M1').due_at='2099-01-01';d.canvas[TERM].submissions.find(s=>s.user_id==='1'&&s.assignment_id==='100').cached_due_at=new Date(Date.now()-1000).toISOString();});
  for(const submit of [false,true])await assert.rejects(b.saveSurvey(TERM,surveyFixture(),submit),/closed/);
  change(d=>d.canvas[TERM].submissions.find(s=>s.user_id==='1'&&s.assignment_id==='100').cached_due_at=null);assert.equal((await b.mySurvey(TERM)).due_at,null);
  await b.pickRole('instructor');await b.openTerm('Spring 2028');await b.pickRole('student');assert.equal((await b.mySurvey(TERM)).read_only,true);
  await assert.rejects(b.saveSurvey(TERM,surveyFixture(),false),/read-only/);await assert.rejects(b.mySurvey('spring-2028'));
});
test('a zero-roster test account gets its signed-in UNI and an empty name',async()=>{
  change(d=>{d.roster=[];});await b.pickRole('test');const own=await b.mySurvey(TERM);assert.equal(own.uni,'test1');assert.equal(own.roster_name,'');assert.equal(own.read_only,false);assert.equal(own.due_at,null);
});
