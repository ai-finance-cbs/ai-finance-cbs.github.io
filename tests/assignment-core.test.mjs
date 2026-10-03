import {test} from 'node:test';
import assert from 'node:assert/strict';
import {itemName,dueCountdown,assignmentBody} from '../assets/materials/assignment-core.js';
import {prepMarkdown} from '../assets/materials/prep-core.js';
test('student names use assignment titles while quizzes and optional tasks keep their names',()=>{
  assert.equal(itemName({code:'M1',title:'Milestone #1'},[{id:1,title:'Pre-Class Survey'}]),'Milestone #1: Pre-Class Survey');
  assert.equal(itemName({code:'M2',title:'Milestone #2: Proposal and Task Map'}),'Milestone #2: Proposal and Task Map');
  assert.equal(itemName({code:'FP',title:'Final Prototype'}),'Final Prototype');
  assert.equal(itemName({code:'O1',title:'Confidently Wrong'}),'Confidently Wrong');
  assert.equal(itemName({code:'Q1',title:'In-class quiz 1'}),'In-class quiz 1');
});
test('countdowns cover days, hours, the deadline, and minute changes using the actual instant',()=>{
  const now=Date.parse('2027-01-24T10:00:00Z'),due='2027-01-27T14:00:00Z';
  assert.equal(dueCountdown(due,now),'3 days 4 hrs remaining');
  assert.equal(dueCountdown(due,Date.parse(due)-65*60000),'1 hrs 5 min remaining');
  assert.equal(dueCountdown(due,Date.parse(due)-64*60000),'1 hrs 4 min remaining');
  assert.equal(dueCountdown(due,Date.parse(due)),'Past due');assert.equal(dueCountdown(due,Date.parse(due)+1),'Past due');
});
test('assignment Markdown stays escaped and opens only safe links in new tabs',()=>{
  const html=prepMarkdown('# Title\n\n**Bold** and *italic*\n\n- List\n\n[Web](https://example.test/)\n<img src=x onerror=alert(1)>\n[x](javascript:alert)',{newTab:true});
  assert.match(html,/<a target="_blank" href="https:\/\/example.test\/" rel="noopener noreferrer">/);
  assert.match(html,/<strong>Bold<\/strong>/);assert.match(html,/<em>italic<\/em>/);assert.match(html,/<ul>/);
  assert.doesNotMatch(html,/<img|href="javascript:/);assert.match(html,/&lt;img/);
  const table=prepMarkdown('| Task | Output |\n| --- | --- |\n| **Demo** | <img src=x onerror=alert(1)> |',{newTab:true});
  assert.match(table,/<table><thead><tr><th>Task<\/th>/);assert.match(table,/<td><strong>Demo<\/strong><\/td>/);
  assert.doesNotMatch(table,/<img/);assert.match(table,/&lt;img/);
  assert.equal(assignmentBody('M1','🌐'.repeat(50000)).length,100000);assert.throws(()=>assignmentBody('Q1',''));assert.throws(()=>assignmentBody('M1','x'.repeat(50001)));
});
