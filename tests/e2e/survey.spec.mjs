import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {surveyFixture} from '../fixtures/survey.mjs';
import {AI_TOOLS,SETUP_TOOLS,VIEWS,SURVEY_OPENING,QUESTIONS} from '../../assets/materials/survey-core.js';
const url='/materials/assignments/milestone-1/',term='spring-2027';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const form=page=>page.locator('#submission-M1 .survey-editor');
const status=page=>page.locator('#submission-M1 > .assignment-panel-head .survey-status');
const saved=page=>expect(status(page)).toContainText('Saved!');
const enter=async(page,role='student')=>{await page.goto(`${url}?fakeauth=${role}`);await ready(page);};
async function fill(page) {
  const f=form(page),v=surveyFixture();
  for(const [label,key] of [['Full name','full_name'],[QUESTIONS.q2,'preferred_name'],[QUESTIONS.q4,'job'],['One or two example firms or roles','career_examples'],[QUESTIONS.q7,'ai_use'],[QUESTIONS.q8,'wish'],[QUESTIONS.s2,'setup_version'],[QUESTIONS.s3,'setup_haiku']])await f.getByLabel(label,{exact:true}).fill(v.answers[key]);
  await f.getByRole('radio',{name:v.answers.program,exact:true}).check();await f.getByLabel(QUESTIONS.q5,{exact:true}).selectOption(v.answers.sector);
  for(const [id,name] of AI_TOOLS)await f.getByRole('radio',{name:`${name}: ${v.answers.ai_frequency[id]}`,exact:true}).check();
  for(const [id,name] of SETUP_TOOLS)await f.getByRole('radio',{name:`${name}: ${v.answers.experience[id]}`,exact:true}).check();
  for(const [id,name] of VIEWS)if(v.q9.includes(id))await f.getByRole('checkbox',{name,exact:true}).check();
  await f.getByLabel(QUESTIONS.q10,{exact:true}).fill(String(v.q10));await f.getByRole('radio',{name:'Codex',exact:true}).check();
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-24T14:00:00Z'));
});
test('exact question wording, no Why notes, signed-in prefill, and Setup Guide link',async({page})=>{
  await enter(page);const f=form(page);await expect(f.locator('.survey-opening')).toHaveText(SURVEY_OPENING);
  for(const question of Object.values(QUESTIONS))await expect(f).toContainText(question);
  await expect(f.getByRole('textbox',{name:'S3. Paste the haiku your assistant wrote for: "Summarize the contents of this folder into a short haiku. Include the word YOUR-UNI."',exact:true})).toBeEditable();
  await expect(f).not.toContainText('Why:');await expect(f.getByLabel('Full name',{exact:true})).toHaveValue('Demo Student');
  await expect(f.getByLabel('UNI',{exact:true})).toHaveValue('ab1234');await expect(f.getByLabel('UNI',{exact:true})).toHaveAttribute('readonly','');
  await expect(f.locator('.survey-section').last().getByRole('link',{name:'Setup Guide',exact:true})).toHaveAttribute('href','/syllabus/setup/');
  await expect(f.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0);
  await expect(status(page)).toHaveClass(/in-panel-head/);await expect(f.locator('.survey-status')).toHaveCount(0);
  await expect(f.getByLabel(QUESTIONS.q2,{exact:true})).toBeVisible();
  await expect(f).not.toContainText('Name to use in class');
  await expect(f.getByRole('checkbox')).toHaveCount(8);await expect(f.getByRole('button',{name:'Export CSV'})).toHaveCount(0);
});
test('student draft reload submit resubmit and failed-save recovery preserve every answer',async({page})=>{
  await page.route('**/assets/materials/survey-demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('async saveSurvey(term,payload,submit) {',
    'async saveSurvey(term,payload,submit) { if(window.failSurvey)throw Error("Test save failure."); ')});});
  await enter(page);const f=form(page);await f.getByLabel(QUESTIONS.q2,{exact:true}).fill('Draft name');
  await saved(page);
  await page.reload();await ready(page);await expect(f.getByLabel(QUESTIONS.q2,{exact:true})).toHaveValue('Draft name');await fill(page);
  await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page).locator('.survey-state')).toContainText('Submitted Jan 24');
  await page.clock.setFixedTime(new Date('2027-01-25T14:00:00Z'));await page.evaluate(()=>window.failSurvey=true);await f.getByLabel(QUESTIONS.q10,{exact:true}).fill('0');
  await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toHaveText('Test save failure.');await expect(status(page)).toContainText('Unsaved changes');
  await expect(f.getByLabel(QUESTIONS.q10,{exact:true})).toHaveValue('0');await page.evaluate(()=>window.failSurvey=false);await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page).locator('.survey-state')).toContainText('Submitted Jan 25');
  await page.reload();await ready(page);await expect(f.getByLabel(QUESTIONS.q10,{exact:true})).toHaveValue('0');await expect(f.getByLabel(QUESTIONS.s3,{exact:true})).toHaveValue(surveyFixture().answers.setup_haiku);
});
test('autosave shows Saving then Saved and keeps edits made during a slow request',async({page})=>{
  await page.route('**/assets/materials/survey-demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('async saveSurvey(term,payload,submit) {',
    'async saveSurvey(term,payload,submit) { if(window.delaySurvey){window.delaySurvey=false;await new Promise(resolve=>window.releaseSurvey=resolve);} ')});});
  await enter(page);await page.evaluate(()=>window.delaySurvey=true);
  const input=form(page).getByLabel(QUESTIONS.q2,{exact:true});await input.fill('First edit');await expect(status(page)).toContainText('Saving…');
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseSurvey)).toBe('function');
  await expect(input).toBeEditable();await input.fill('Latest edit');await page.evaluate(()=>window.releaseSurvey());await saved(page);
  await page.reload();await ready(page);await expect(input).toHaveValue('Latest edit');
});
test('failed autosave keeps answers and unsaved status; the next edit retries',async({page})=>{
  await page.route('**/assets/materials/survey-demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('async saveSurvey(term,payload,submit) {',
    'async saveSurvey(term,payload,submit) { if(window.failSurvey)throw Error("Autosave unavailable."); ')});});
  await enter(page);await page.evaluate(()=>window.failSurvey=true);
  const input=form(page).getByLabel(QUESTIONS.q2,{exact:true});await input.fill('Kept locally');
  await expect(form(page).locator('.survey-message')).toHaveText('Autosave unavailable.');await expect(status(page)).toContainText('Unsaved changes');await expect(input).toHaveValue('Kept locally');
  await page.evaluate(()=>window.failSurvey=false);await input.fill('Retry edit');await saved(page);await page.reload();await ready(page);await expect(input).toHaveValue('Retry edit');
});
test('autosave keeps complete submissions submitted; incomplete edits require explicit resubmission',async({page})=>{
  await enter(page);await page.evaluate(async v=>{await(await import('/assets/materials/demo.js')).createDemo().saveSurvey('spring-2027',v,true);},surveyFixture());
  await page.reload();await ready(page);const f=form(page);await f.getByLabel(QUESTIONS.q10,{exact:true}).fill('60');await saved(page);await expect(status(page).locator('.survey-state')).toContainText('Submitted');
  await f.getByLabel(QUESTIONS.q2,{exact:true}).fill('');await saved(page);await expect(status(page).locator('.survey-state')).toHaveText('Draft');await expect(f).toContainText('submission is no longer complete');
  await f.getByLabel(QUESTIONS.q2,{exact:true}).fill('Complete again');await saved(page);await expect(status(page).locator('.survey-state')).toHaveText('Draft');
  await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page).locator('.survey-state')).toContainText('Submitted');
});
test('required questions, Q9 selection, Q10 bounds, optional fields, and Other naming validate inline',async({page})=>{
  await enter(page);const f=form(page);await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toContainText('Q2');await fill(page);
  for(const box of await f.getByRole('checkbox').all())await box.uncheck();await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toContainText('Q9');
  await f.getByRole('checkbox',{name:'I am not sure yet.',exact:true}).check();await f.getByLabel(QUESTIONS.q10,{exact:true}).fill('101');
  await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toContainText('0 to 100');await f.getByLabel(QUESTIONS.q10,{exact:true}).fill('50.5');
  await f.getByRole('radio',{name:'Other (name it): Weekly',exact:true}).check();await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toContainText('other tool');
  await f.getByLabel('Other (name it)',{exact:true}).fill('Synthetic tool');await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.survey-message')).toHaveText('Survey submitted.');
});
test('individual Canvas cutoff locks both draft and submit; stale site dates cannot reopen it',async({page})=>{
  await enter(page);await fill(page);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.survey-message')).toHaveText('Survey submitted.');
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.items.find(i=>i.code==='M1').due_at='2099-01-01';d.canvas['spring-2027'].assignments.find(a=>a.id==='100').due_at='2099-01-01';d.canvas['spring-2027'].submissions.find(s=>s.assignment_id==='100'&&s.user_id==='1').cached_due_at='2027-01-24T14:00:00Z';sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(form(page).locator('.survey-warning')).toContainText('Submissions closed Jan 24');await expect(form(page).getByLabel('Full name',{exact:true})).toBeDisabled();await expect(form(page).getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async v=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const submit of [false,true])try{await b.saveSurvey('spring-2027',v,submit);}catch{denied++;}return denied;},surveyFixture())).toBe(2);
});
test('no roster row leaves the permitted test student name blank and editable, never hides the form',async({page})=>{
  await enter(page,'instructor');await page.evaluate(async()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.roster=[];sessionStorage.setItem(k,JSON.stringify(d));await(await import('/assets/materials/demo.js')).createDemo().pickRole('test');});
  await page.goto(url);await ready(page);const f=form(page);await expect(f).toBeVisible();await expect(f.getByLabel('Full name',{exact:true})).toHaveValue('');await expect(f.getByLabel('Full name',{exact:true})).toBeEditable();await expect(f.getByLabel('UNI',{exact:true})).toHaveValue('test1');
  await f.getByLabel('Full name',{exact:true}).fill('Test name');await expect(f.getByRole('button',{name:'Submit',exact:true})).toBeDisabled();await expect(f.locator('.survey-warning')).toContainText('deadline unavailable');
});
for(const role of ['instructor','grader'])test(`${role} sees submitted-only summaries, individual responses, and a complete safe CSV`,async({page})=>{
  await enter(page);await page.evaluate(async v=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.saveSurvey('spring-2027',v,true);await b.pickRole('instructor');const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k)),first=d.surveys[0];
    first.answers.full_name='=1+1';first.answers.job='A "quoted", multiline\njob';d.surveys.push({...structuredClone(first),uni:'cd5678',q10:75,answers:{...first.answers,sector:'Fintech / tech',setup_assistant:'Claude Code'}});
    d.surveys.push({...structuredClone(first),uni:'ef9012',status:'draft',submitted_at:null,q10:100});sessionStorage.setItem(k,JSON.stringify(d));},surveyFixture());
  await enter(page,role);const staff=page.locator('.survey-staff');await expect(staff.locator('.survey-counts')).toHaveText('2 submitted / 4 roster · 1 drafts · 1 not started');await expect(staff.locator('.survey-distribution')).toHaveText('Min 25% · Median 50% · Max 75%');
  await expect(staff.locator('.survey-summary').first().locator('dd')).toHaveText(['0','0','2','0','0','0','0','2']);
  await expect(staff.locator('.survey-summary').nth(2)).toContainText('Consulting');await expect(staff.locator('.survey-summary').nth(2).locator('dd')).toHaveText(['0','0','0','0','0','1','1','0','0']);
  const item=staff.locator('.survey-response').filter({has:page.locator('summary').filter({hasText:'ab1234'})});await item.locator('summary').click();await expect(item.getByLabel('Full name',{exact:true})).toHaveValue('=1+1');await expect(item.getByLabel('Full name',{exact:true})).toBeDisabled();
  await expect(item.getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
  const downloadEvent=page.waitForEvent('download');await staff.getByRole('button',{name:'Export CSV'}).click();const download=await downloadEvent;await download.saveAs(`evidence/survey/${role}.csv`);
  const csv=readFileSync(await download.path(),'utf8');for(const text of ['ab1234','cd5678','ef9012','test1','Q10 Percent','S4 Problems','not_started'])expect(csv).toContain(text);
  expect(csv).toContain('"\'=1+1"');expect(csv).toContain('"A ""quoted"", multiline\njob"');expect(csv).toContain(surveyFixture().answers.setup_haiku);
});
test('preview shows the selected response read-only and denies writes and class/CSV data',async({page})=>{
  await enter(page);await page.evaluate(async v=>{await(await import('/assets/materials/demo.js')).createDemo().saveSurvey('spring-2027',v,true);},surveyFixture());
  await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await expect(form(page).getByLabel('Full name',{exact:true})).toHaveValue('Synthetic Student');await expect(form(page).getByLabel('Full name',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Export CSV'})).toHaveCount(0);
  expect(await page.evaluate(async v=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const fn of [()=>b.saveSurvey('spring-2027',v,true),()=>b.surveyClass('spring-2027')])try{await fn();}catch{denied++;}return denied;},surveyFixture())).toBe(2);
});
for(const role of ['auditor','unlisted'])test(`${role} cannot see responses, CSV or the form`,async({page})=>{
  await enter(page,role);await expect(page.locator('#submission-M1')).toHaveCount(0);await expect(page.getByRole('button',{name:'Export CSV'})).toHaveCount(0);
  expect(await page.evaluate(async v=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const fn of [()=>b.mySurvey('spring-2027'),()=>b.saveSurvey('spring-2027',v,false),()=>b.surveyClass('spring-2027')])try{await fn();}catch{denied++;}return denied;},surveyFixture())).toBe(3);
});
test('unsaved changes warn on sign-out and instruction edits preserve the staff panel',async({page})=>{
  await enter(page);await form(page).getByLabel('Full name',{exact:true}).fill('Unsaved name');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unsaved changes');await page.getByRole('button',{name:'Keep editing'}).click();await expect(form(page).getByLabel('Full name',{exact:true})).toHaveValue('Unsaved name');
  await saved(page);await enter(page,'instructor');
  await page.getByRole('button',{name:'Edit AI Policy',exact:true}).click();await page.getByLabel('AI Policy text',{exact:true}).fill('Synthetic policy');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('.survey-counts')).toContainText('1 drafts');
});
for(const width of [1280,390,320])test(`survey grids and expanded staff responses fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await enter(page);await fill(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`evidence/survey/student-${width}.png`,fullPage:true});await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.survey-message')).toHaveText('Survey submitted.');
  await enter(page,'instructor');await page.locator('.survey-response summary').filter({hasText:'ab1234'}).click();await expect(form(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`evidence/survey/staff-${width}.png`,fullPage:true});
});
