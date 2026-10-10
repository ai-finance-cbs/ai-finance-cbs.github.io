import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptySurvey,validateSurvey,surveySummary,surveyCSV,surveyClosed,TEXT_LIMITS} from '../assets/materials/survey-core.js';
import {surveyFixture} from './fixtures/survey.mjs';
test('drafts accept blanks; submit requires every required question and preserves optional blanks and zero',()=>{
  validateSurvey(emptySurvey());assert.throws(()=>validateSurvey(emptySurvey(),true),/Q1/);
  const v=surveyFixture();v.q10=0;validateSurvey(v,true);
  for(const key of ['full_name','preferred_name','job','career_examples','ai_use','wish','setup_version','setup_haiku','program','sector','setup_assistant']) {
    const value=surveyFixture();value.answers[key]='';assert.throws(()=>validateSurvey(value,true),/Complete/);
  }
  v.answers.setup_assistant='I could not finish setup.';v.answers.setup_version='Not installed';v.answers.setup_haiku='Not available';validateSurvey(v,true);
  v.q9=[];assert.throws(()=>validateSurvey(v,true),/Q9/);v.q9=['unsure'];v.q10=null;assert.throws(()=>validateSurvey(v,true),/Q10/);
});
test('grids are exact, Other tool naming is conditional, and choices cannot smuggle extra fields',()=>{
  const v=surveyFixture();v.answers.ai_frequency.other='Weekly';assert.throws(()=>validateSurvey(v,true),/other tool/);v.answers.other_tool='Example AI';validateSurvey(v,true);
  const changes=[v=>v.answers.program='Unknown',v=>v.answers.sector='Unknown',v=>v.answers.setup_assistant='Unknown',
    v=>v.answers.ai_frequency.chatgpt='Often',v=>delete v.answers.experience.excel,v=>v.answers.experience.extra='Never',v=>v.answers.constructor='extra',
    v=>v.q9=['augment','augment'],v=>v.q9=['wrong'],v=>v.q9=[1],v=>v.q9=null,v=>v.q10='25',v=>v.q10=-1,v=>v.q10=101,v=>v.q10=NaN,v=>v.q10=Infinity];
  for(const change of changes){const value=surveyFixture();change(value);assert.throws(()=>validateSurvey(value));}
  for(const [key,cap] of Object.entries(TEXT_LIMITS)){const value=surveyFixture();value.answers[key]='x'.repeat(cap+1);assert.throws(()=>validateSurvey(value));}
  v.answers.full_name='😀'.repeat(120);v.q10=50.5;validateSurvey(v,true);
});
test('summaries count submitted responses, include zero, and calculate an even-sample median',()=>{
  const rows=[0,20,80,100].map((q10,i)=>({uni:`aa${i}`,submission:{...surveyFixture(),q10,status:'submitted'}}));
  rows.push({submission:{...surveyFixture(),status:'draft'}},{submission:null});
  const s=surveySummary(rows);assert.equal(s.roster,6);assert.equal(s.submitted,4);assert.equal(s.drafts,1);
  assert.deepEqual(s.q10,{min:0,median:50,max:100});assert.equal(s.q9.augment,4);assert.equal(s.q9.overhyped,0);assert.equal(s.sectors.Consulting,4);assert.equal(s.setup.Codex,4);
  assert.equal(surveySummary([]).q10,null);assert.equal(surveySummary(rows.slice(0,3)).q10.median,20);
});
test('CSV has every answer and student, quotes commas and newlines, and blocks spreadsheet formulas',()=>{
  const v=surveyFixture();v.answers.full_name='=1+1';v.answers.job='A "quoted", multiline\njob';v.q10=0;
  const csv=surveyCSV([{uni:'aa1001',name:'+formula',submission:{...v,status:'submitted'}},{uni:'bb1002',name:'No response',submission:null}]);
  assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\'+formula"'));assert.ok(csv.includes('"A ""quoted"", multiline\njob"'));
  for(const name of ['Q9 AI will change','Q10 Percent','Q6 Other tool name','S4 Problems','bb1002','not_started'])assert.ok(csv.includes(name),name);
  for(const prefix of ['\t=','\n@','  +','-']){v.answers.other_info=prefix+'value';assert.ok(surveyCSV([{uni:'aa1',name:'A',submission:v}]).includes('"\''+prefix+'value"'));}
});
test('deadline closes at the cutoff and fails closed when Canvas has no valid date',()=>{
  const due='2027-02-01T14:00:00Z';assert.equal(surveyClosed(due,Date.parse(due)-1),false);
  for(const value of [due,null,'bad'])assert.equal(surveyClosed(value,Date.parse(due)),true);
});
