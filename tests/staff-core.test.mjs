import test from 'node:test';
import assert from 'node:assert/strict';
import {newYorkInput,newYorkTime,gradingSubmission,groupOverride} from '../assets/materials/staff-core.js';

test('New York wall times round-trip across March independently of the machine time zone',()=>{
  for(const [wall,utc] of [['2027-03-13T09:00','2027-03-13T14:00:00.000Z'],['2027-03-15T09:00','2027-03-15T13:00:00.000Z']]){assert.equal(newYorkTime(wall),utc);assert.equal(newYorkInput(utc),wall);}
  assert.equal(newYorkTime(''),null);assert.equal(newYorkInput(null),'');
  assert.throws(()=>newYorkTime('2027-03-14T02:30'),/does not exist/);
  assert.throws(()=>newYorkTime('2027-11-07T01:30'),/occurs twice/);
  assert.throws(()=>newYorkTime('not-a-date'),/valid New York/);
});
test('grading follows submitted members after a move; zero group scores and cleared overrides count',()=>{
  const item={id:2,mode:'group',group_set_id:'set'},submission={item_id:2,group_id:'original',member_unis:['a','b']};
  const d={submissions:[submission],members:[{uni:'a',set_id:'set',group_id:'new'}],groups:[{id:'new'}],grades:[{uni:'a',item_id:2,score:1},{uni:'b',item_id:2,score:0}],group_grades:[{item_id:2,group_id:'original',score:0}]};
  assert.equal(gradingSubmission(d,item,'a'),submission);assert.equal(groupOverride(d,item,'a',submission),true);assert.equal(groupOverride(d,item,'b',submission),false);
  d.grades=[];assert.equal(groupOverride(d,item,'b',submission),true);
});

test('optional task week links use deadlines and fall back to Week 6 when undated',async()=>{
  const {submissionWeek}=await import('../assets/materials/staff-core.js');
  assert.equal(submissionWeek('M4'),4);assert.equal(submissionWeek('FP'),6);assert.equal(submissionWeek('O1'),6);
  assert.equal(submissionWeek('O2',{due_at:'2027-02-03T13:00:00Z'},[{week:3,starts_at:'2027-02-03T14:00:00Z'},{week:4,starts_at:'2027-02-10T14:00:00Z'}]),3);
});
