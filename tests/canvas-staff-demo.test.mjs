import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
let b;const TERM='spring-2027',KEY='b8403-demo-state-v3';
beforeEach(async()=>{const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};globalThis.window={location:new URL('http://127.0.0.1:4187/materials/')};b=createDemo();await b.pickRole('instructor');await b.syncCanvas(TERM);});
const change=fn=>{const d=JSON.parse(sessionStorage.getItem(KEY));fn(d.canvas[TERM],d);sessionStorage.setItem(KEY,JSON.stringify(d));};
const setQuiz=fields=>change(c=>{const id=c.mappings.find(m=>m.site_key==='Q1').canvas_assignment_id;Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===id),fields);});
const record=async()=>(await b.classData()).attendance.find(a=>a.uni==='ab1234'&&a.week===1);
for(const role of ['student','instructor','grader','auditor','unlisted','preview'])test(`demo ${role} cannot change grades, posting, or roster`,async()=>{
  if(role==='preview')await b.setPreview('ab1234');else await b.pickRole(role);
  const before=sessionStorage.getItem(KEY);for(const name of ['saveGrades','gradeGroup','releaseItem','replaceRoster'])await assert.rejects(b[name](),/CourseWorks/);
  assert.equal(sessionStorage.getItem(KEY),before);
});
test('demo sync applies quiz facts once, supersedes an excuse, and preserves its audit after withdrawal',async()=>{
  await b.saveAttendance(1,[{uni:'ab1234',status:'excused',excuse_reason:'Approved'}]);
  setQuiz({score:0,workflow_state:'graded',submitted_at:null});await b.syncCanvas(TERM);assert.equal((await record()).status,'present');assert.equal((await record()).excuse_reason,null);
  const n=JSON.parse(sessionStorage.getItem(KEY)).attendance_audit.length;await b.syncCanvas(TERM);assert.equal(JSON.parse(sessionStorage.getItem(KEY)).attendance_audit.length,n);
  setQuiz({missing:true,late_policy_status:'missing'});await b.syncCanvas(TERM);assert.equal(await record(),undefined);
});
test('demo unposted status ignores private grading flags and recomputes posted visibility on sync',async()=>{
  change(c=>Object.assign(c.submissions[0],{excused:true,missing:true,late:true,late_policy_status:'missing',posted_at:null,submitted_at:'2027-02-28T14:00:00Z'}));
  await b.syncCanvas(TERM);await b.pickRole('student');let s=(await b.canvasStudentData(TERM)).items[0];assert.equal(s.status,'Done');assert.equal(s.score,null);
  await b.pickRole('instructor');change(c=>c.submissions[0].posted_at='2027-03-02T14:00:00Z');await b.syncCanvas(TERM);await b.pickRole('student');s=(await b.canvasStudentData(TERM)).items[0];assert.equal(s.status,'Excused');
});

test('staff download current and on-time archived files after rollover; closed-term students and preview cannot',async()=>{
  change((c,d)=>d.submissions.push({id:'archive-file',term_id:TERM,item_id:1,owner_uni:'ab1234',member_unis:['ab1234'],data:'data:text/plain,current',on_time_data:'data:text/plain,on-time'}));
  await b.openTerm('Spring 2028');
  const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms)=>{const id=timer(fn,ms);id.unref?.();return id;};
  try {
    for(const role of ['instructor','grader']) {
      await b.pickRole(role);
      for(const version of ['current','on-time']){const url=await b.submissionUrl('archive-file',version);assert.equal(await (await fetch(url)).text(),version);URL.revokeObjectURL(url);}
    }
    await b.pickRole('auditor');await assert.rejects(b.submissionUrl('archive-file'),/unavailable/);
    await b.pickRole('instructor');await b.setPreview('test1','spring-2028');await assert.rejects(b.submissionUrl('archive-file'),/unavailable/);
    await b.pickRole('instructor');const d=JSON.parse(sessionStorage.getItem(KEY));d.terms.find(t=>t.id===TERM).status='closed';sessionStorage.setItem(KEY,JSON.stringify(d));
    await b.pickRole('student');await assert.rejects(b.submissionUrl('archive-file'),/unavailable/);
  } finally {globalThis.setTimeout=timer;}
});
