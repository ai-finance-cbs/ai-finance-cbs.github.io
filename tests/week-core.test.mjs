import test from 'node:test';
import assert from 'node:assert/strict';
import { currentWeek, weekSlug, courseTime, ownGroup, ownSubmission, studentGradeRows, inClassFile } from '../assets/materials/week-core.js';
test('landing switches at the exact class end, falls back to week 1, and stays on Week 6 after the last class', () => {
  const sessions = [1,2,3,4,5,6].map(week=>({week,ends_at:`2027-01-${String(week+10).padStart(2,'0')}T18:00:00Z`}));
  assert.equal(currentWeek([],Date.now()),1);
  assert.equal(currentWeek([{week:1,date:'2027-01-01'}]),1);
  assert.equal(currentWeek(sessions,Date.parse('2027-01-12T17:59:59Z')),2);
  assert.equal(currentWeek(sessions,Date.parse('2027-01-12T18:00:00Z')),3);
  assert.equal(currentWeek(sessions,Date.parse('2027-01-16T18:00:00Z')),6);
  assert.equal(weekSlug(7),'week-6'); assert.equal(weekSlug(0),'week-1');
  assert.equal(weekSlug(3),'week-3');
});
test('due timestamps display New York time across daylight saving dates', () => {
  assert.equal(courseTime('2027-01-26T14:00:00Z'),'Tue, Jan 26, 9:00 AM');
  assert.equal(courseTime('2027-06-01T13:00:00Z'),'Tue, Jun 1, 9:00 AM');
});
test('submission lookup uses the current group in the linked set or the individual owner', () => {
  const data={members:[{set_id:'set',group_id:'g',uni:'ab1234'}],groups:[{id:'g',number:4}],submissions:[{item_id:3,group_id:'g',file_name:'own.pdf'},{item_id:4,owner_uni:'other',file_name:'other.pdf'},{item_id:4,owner_uni:'ab1234',file_name:'mine.pdf'}]};
  const group={id:3,group_set_id:'set',mode:'group'};
  assert.equal(ownGroup(data,group,'ab1234').number,4);
  assert.equal(ownSubmission(data,group,'ab1234').file_name,'own.pdf');
  assert.equal(ownSubmission(data,group,'outsider'),undefined);
  assert.equal(ownSubmission(data,{id:4,mode:'individual'},'ab1234').file_name,'mine.pdf');
});
test('grade rows order codes across term-specific IDs and withhold unreleased scores and comments', () => {
  const rows=studentGradeRows({items:[{id:101,code:'M1',released:true,max_points:10},{id:103,code:'M3',released:false}],grades:[{item_id:101,score:0,comment:'Released'},{item_id:103,score:9,comment:'Secret'}],submission_items:[{id:103,code:'M3',kind:'file'}],submissions:[{item_id:103,late:true}]});
  assert.deepEqual(rows.map(r=>r.code),['M1','M2','M3','M4','M5','FP','Q1','Q2','Q3','Q4','Q5','PA','O1','O2','O3','O4']);
  assert.equal(rows[0].grade.comment,'Released'); assert.equal(rows[0].grade.score,0);
  assert.equal(rows[2].grade,null); assert.equal(rows[2].submission.late,true);
});
test('file categories use metadata and never infer the category from a title', () => {
  assert.equal(inClassFile({title:'Exercise',category:'in_class'}),true);
  assert.equal(inClassFile({title:'In-class: a note title',category:'notes'}),false);
});
