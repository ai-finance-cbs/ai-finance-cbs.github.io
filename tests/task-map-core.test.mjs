import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyTaskMap,validateTaskMap,taskTally,wordCount,taskMapClosed,taskMapSummary} from '../assets/materials/task-map-core.js';
import {taskMapFixture} from './fixtures/task-map.mjs';
test('drafts retain incomplete rows; submission needs eight complete tasks and both reflections',()=>{
  const draft=emptyTaskMap(); assert.equal(draft.tasks.length,10); validateTaskMap(draft);
  assert.throws(()=>validateTaskMap(draft,true),/8 tasks|8 complete|8 tasks with/);
  const value=taskMapFixture(); validateTaskMap(value,true);
  value.tasks[0].label=null; assert.throws(()=>validateTaskMap(value,true),/8 tasks/);
  value.tasks[0].label='Process'; value.look_ahead.reasoning=' \n'; assert.throws(()=>validateTaskMap(value,true),/look-ahead/);
  // The look-ahead task needs no label and AI use is no longer required.
  value.look_ahead.reasoning='Reason'; value.look_ahead.label=null; value.look_ahead.name=''; value.ai_use=''; assert.doesNotThrow(()=>validateTaskMap(value,true));
});
test('all text caps, fixed label names, task limits, JSON types, and nested keys validate',()=>{
  const cases=[v=>v.tasks.push(...Array(5).fill(v.tasks[0])),v=>v.tasks[0].label='process',v=>delete v.tasks[0].label,
    v=>v.tasks[0].name='x'.repeat(81),v=>v.tasks[0].description='x'.repeat(401),v=>v.look_ahead.reasoning='x'.repeat(2001),
    v=>v.look_ahead.name='x'.repeat(81),v=>v.look_ahead.description='x'.repeat(401),v=>v.ai_use='x'.repeat(601),
    v=>v.job.role='x'.repeat(121),v=>v.job.firm_type=1,v=>v.tasks=[null],v=>v.look_ahead=[],v=>v.tasks[0].reasoning='extra',
    v=>v.tasks[0].constructor='extra'];
  for(const change of cases){const value=taskMapFixture(); change(value); assert.throws(()=>validateTaskMap(value));}
  const value=taskMapFixture(); value.tasks[0].name='😀'.repeat(80); validateTaskMap(value,true);
});
test('tallies use fixed order, counts ignore blank selections, and word counts ignore extra space',()=>{
  assert.deepEqual(taskTally([...taskMapFixture().tasks,{label:null}]),{Process:2,Predict:2,Persuade:2,Own:2});
  assert.equal(wordCount('  A\n person  signs off. '),4); assert.equal(wordCount(''),0);
});
test('deadlines fail closed when absent or invalid and close exactly at the cutoff',()=>{
  const due='2027-01-25T15:00:00Z'; assert.equal(taskMapClosed(due,Date.parse(due)-1),false);
  for(const date of [due,null,'broken'])assert.equal(taskMapClosed(date,Date.parse(due)),true);
});
test('staff summaries count roster statuses and only complete submitted tasks',()=>{
  const submitted={...taskMapFixture(),status:'submitted'};
  submitted.tasks.push({name:'',description:'',label:'Own'});
  const result=taskMapSummary([{submission:submitted},{submission:{...taskMapFixture(),status:'draft'}},{submission:null}]);
  assert.deepEqual(result.counts,{submitted:1,drafts:1,not_started:1}); assert.equal(result.total,8);
  assert.equal(result.own.length,2); assert.equal(result.lookAhead.length,1);
});
