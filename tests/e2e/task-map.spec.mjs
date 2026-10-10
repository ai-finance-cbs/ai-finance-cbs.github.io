import {test,expect} from '@playwright/test';
import {taskMapFixture} from '../fixtures/task-map.mjs';
const URL='/materials/assignments/milestone-2/';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const AHEAD_TASK='Which task is not part of this job today but will become part of it as AI spreads? Describe it in a sentence or two.',REASON='Why do you think so? (three to five sentences)';
const autosaved=f=>expect(f.page().locator('#submission-M2 .task-map-status')).toContainText('Last saved',{timeout:8000});
const form=page=>page.locator('#submission-M2 .task-map-editor');
const enter=async(page,role='student')=>{await page.goto(`${URL}?fakeauth=${role}`);await ready(page);};
async function fill(page) {
  const value=taskMapFixture(),f=form(page);
  for(const [label,key] of [['What kind of firm did you work at?','firm_type'],['What was your role?','role'],['How long were you there?','duration']])await f.getByLabel(label,{exact:true}).fill(value.job[key]);
  for(let i=0;i<8;i++){
    await f.getByLabel(`Task ${i+1}`,{exact:true}).fill(value.tasks[i].name);
    await f.getByLabel(`Description ${i+1}`,{exact:true}).fill(value.tasks[i].description);
    await f.getByLabel(`Label ${i+1}`,{exact:true}).selectOption(value.tasks[i].label);
  }
  await f.getByLabel(AHEAD_TASK,{exact:true}).fill(value.look_ahead.description);
  await f.getByLabel(REASON,{exact:true}).fill(value.look_ahead.reasoning);
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-20T14:00:00Z'));
});
test('student draft autosaves and survives reload, submits, resubmits, and keeps edits when saving fails',async({page})=>{
  await enter(page);await expect(form(page).locator('.task-map-tasks tbody tr')).toHaveCount(10);
  await form(page).getByLabel('Task 1',{exact:true}).fill('First draft');
  await expect(form(page).locator('.task-map-panel').nth(1).locator('.task-map-panel-note')).toHaveText(/Saving…|Saved!/);
  await expect(form(page).locator('.task-map-panel').first().locator('.task-map-panel-note')).toHaveText('');
  await autosaved(form(page));
  await page.reload();await ready(page);await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('First draft');
  await fill(page);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(page.locator('#submission-M2 .task-map-state')).toContainText('Submitted Jan 20');
  await page.clock.setFixedTime(new Date('2027-01-21T14:00:00Z'));
  await form(page).getByLabel('Task 1',{exact:true}).fill('Revised action');
  // Every save fails until the test restores storage, so autosave and Submit both hit the failure.
  await page.evaluate(()=>{window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='b8403-demo-state-v3')throw Error('Save failed for test.');return window.realSetItem.call(this,k,v);};});
  await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.task-map-message')).toHaveText('Save failed for test.');
  await page.evaluate(()=>{Storage.prototype.setItem=window.realSetItem;});
  await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('Revised action');
  await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(page.locator('#submission-M2 .task-map-state')).toContainText('Submitted Jan 21');
  await page.reload();await ready(page);await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('Revised action');
});
test('validation, exact label order, Own nudge, word count, and add/remove bounds',async({page})=>{
  await enter(page);const f=form(page);await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.task-map-message')).toContainText('Complete at least 8');
  expect(await f.getByLabel('Label 1',{exact:true}).locator('option').allTextContents()).toEqual(['Choose…','Process','Predict','Persuade','Own']);
  await f.getByLabel('Label 1',{exact:true}).selectOption('Process');await expect(f.locator('.task-map-nudge')).toHaveText('No Own tasks yet. Who signed off?');
  await f.getByLabel('Label 2',{exact:true}).selectOption('Own');await expect(f.locator('.task-map-nudge')).toHaveCount(0);
  await f.getByLabel(REASON,{exact:true}).fill('  People sign off.  ');await expect(f.locator('.task-map-words')).toHaveText('3 words');
  await fill(page);await f.getByLabel(REASON,{exact:true}).fill('');
  await f.getByRole('button',{name:'Submit',exact:true}).click();await expect(f.locator('.task-map-message')).toContainText('Complete the look-ahead');
  await f.getByLabel(REASON,{exact:true}).fill('A reason');
  await f.getByRole('button',{name:'+ Add task',exact:true}).click();await f.getByRole('button',{name:'+ Add task',exact:true}).click();
  await expect(f.getByRole('button',{name:'+ Add task',exact:true})).toBeDisabled();
  for(let i=12;i>1;i--)await f.getByRole('button',{name:`Remove task ${i}`,exact:true}).click();
  await expect(f.getByRole('button',{name:'Remove task 1',exact:true})).toBeDisabled();
  await autosaved(f);await page.reload();await ready(page);await expect(form(page).locator('.task-map-tasks tbody tr')).toHaveCount(1);
});
test('deadline closes the saved form and denies direct draft and submit calls',async({page})=>{
  await enter(page);await fill(page);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.task-map-message')).toHaveText('Task map submitted.');
  await page.clock.setFixedTime(new Date('2027-01-26T14:00:00Z'));await page.reload();await ready(page);
  await expect(form(page).locator('.task-map-warning')).toContainText('Submissions closed Jan 26');
  for(const control of await form(page).locator('input,textarea,select').all())await expect(control).toBeDisabled();
  await expect(form(page).getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
  const errors=await page.evaluate(async value=>{const b=(await import('/assets/materials/demo.js')).createDemo();const errors=[];for(const submit of [false,true])try{await b.saveTaskMap('spring-2027',value,submit);}catch(e){errors.push(e.message);}return errors;},taskMapFixture());
  expect(errors).toHaveLength(2);expect(errors.every(e=>e.includes('closed'))).toBe(true);
});
for(const role of ['instructor','grader'])test(`${role} sees accurate counts, anonymous lists, and read-only expansion`,async({page})=>{
  await enter(page);await fill(page);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.task-map-message')).toHaveText('Task map submitted.');
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('test');const v=(await import('/assets/materials/task-map-core.js')).emptyTaskMap();await b.saveTaskMap('spring-2027',v,false);});
  await enter(page,role);const staff=page.locator('.task-map-staff');await expect(staff.locator('.task-map-class-counts')).toHaveText('1 submitted · 1 drafts · 2 not started');
  await expect(staff.locator('.task-map-tally')).toContainText('Own 2 (25%)');await expect(staff.locator('.task-map-anonymous').first().locator('li')).toHaveCount(2);
  expect(await staff.locator('.task-map-anonymous').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining('ab1234')]));
  await staff.getByRole('button',{name:'Demo Student ab1234'}).click();await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('Task 1');
  await expect(form(page).getByLabel('Task 1',{exact:true})).toBeDisabled();await expect(form(page).getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
});
test('instructor preview shows selected student only, read-only, and denies backend writes',async({page})=>{
  await enter(page);await fill(page);await autosaved(form(page));
  await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('Task 1');
  await expect(form(page).getByLabel('Task 1',{exact:true})).toBeDisabled();
  expect(await page.evaluate(async value=>{try{await(await import('/assets/materials/demo.js')).createDemo().saveTaskMap('spring-2027',value,true);return 'allowed';}catch(e){return e.message;}},taskMapFixture())).toContain('read-only');
});
test('dirty form warns before sign-out and keeps the answers',async({page})=>{
  await enter(page);await form(page).getByLabel('Task 1',{exact:true}).fill('Unsaved action');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unsaved changes');
  await page.getByRole('button',{name:'Keep editing'}).click();await expect(form(page).getByLabel('Task 1',{exact:true})).toHaveValue('Unsaved action');
});
for(const width of [1280,390,320])test(`student and expanded staff forms fit ${width}px without horizontal scroll`,async({page})=>{
  await page.setViewportSize({width,height:1000});await enter(page);await fill(page);
  await form(page).getByLabel('Description 1',{exact:true}).fill('A long description wraps instead of clipping. '.repeat(8));
  const textarea=form(page).getByLabel('Description 1',{exact:true});expect(await textarea.evaluate(e=>e.clientHeight>=e.scrollHeight-2)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`evidence/task-map/student-${width}.png`,fullPage:true});
  await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.task-map-message')).toHaveText('Task map submitted.');
  await enter(page,'instructor');await page.getByRole('button',{name:'Demo Student ab1234'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // The outer roster's name-column width must not spread to the nested task numbers.
  expect(await form(page).locator('.task-map-tasks tbody tr').first().locator('td').first().evaluate(e=>e.getBoundingClientRect().width)).toBeLessThan(40);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`evidence/task-map/staff-${width}.png`,fullPage:true});
});
test('PDF print media includes complete text and colored labels and hides chrome and controls',async({page})=>{
  await enter(page);await fill(page);const long='A full description with line breaks.\n'.repeat(9);await form(page).getByLabel('Description 1',{exact:true}).fill(long);
  await page.evaluate(()=>{window.print=()=>{window.printCalled=true;};});await form(page).getByRole('button',{name:'Export to PDF'}).click();
  expect(await page.evaluate(()=>window.printCalled)).toBe(true);await expect(page.locator('.task-map-print-target')).toBeHidden();
  await page.emulateMedia({media:'print'});const paper=page.locator('.task-map-print-target');await expect(paper).toBeVisible();await expect(paper).toContainText(long);
  await expect(paper).toContainText('Summer analyst');await expect(paper).not.toContainText('AI use');
  await expect(page.locator('.topbar')).toBeHidden();await expect(form(page)).toBeHidden();expect(await paper.locator('input,textarea,button,select').count()).toBe(0);
  expect(await paper.locator('.is-own').first().evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(179, 38, 30)');
  await page.pdf({path:'evidence/task-map/task-map.pdf',printBackground:true});
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(paper).toHaveCount(0);
});
for(const role of ['auditor','unlisted'])test(`${role} has no M2 submission data or form`,async({page})=>{
  await enter(page,role);await expect(page.locator('#submission-M2')).toHaveCount(0);
  expect(await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const call of [()=>b.myTaskMap('spring-2027'),()=>b.taskMapClass('spring-2027')])try{await call();}catch{denied++;}return denied;})).toBe(2);
});
test('other milestones retain their submission placeholder',async({page})=>{
  await page.goto('/materials/assignments/milestone-3/?fakeauth=student');await ready(page);await expect(page.locator('#submission-M3')).toContainText('The submission form will appear here.');
});
test('editing M2 instructions preserves the staff summary and its expanded student',async({page})=>{
  await enter(page,'instructor');const panel=page.locator('#submission-M2'),student=panel.getByRole('button',{name:'Demo Student ab1234'});
  await student.click();await expect(student).toHaveAttribute('aria-expanded','true');
  await page.getByRole('button',{name:'Edit AI Policy',exact:true}).click();
  await expect(panel).toBeVisible();await page.getByLabel('AI Policy text',{exact:true}).fill('Updated policy.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('[data-assignment-section="AI Policy"] .prep-markdown')).toHaveText('Updated policy.');
  await expect(student).toHaveAttribute('aria-expanded','true');
  await expect(panel.locator('.task-map-class-counts')).toHaveText('0 submitted · 0 drafts · 4 not started');
});
