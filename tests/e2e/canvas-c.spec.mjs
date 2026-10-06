import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role='instructor',slug='gradebook')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const cell=page=>page.getByLabel('ab1234 Week 1 attendance',{exact:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.install({time:new Date('2027-01-24T10:00:00Z')});await page.clock.setFixedTime(new Date('2027-01-24T10:00:00Z'));
  mkdirSync('evidence/canvas-c',{recursive:true});
});
async function seed(page){
  await enter(page,'instructor','settings');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();await b.syncCanvas('spring-2027');
    await b.saveAssignment({...((await b.assignments()).find(a=>a.id===1)),title:'Pre-Class Survey'});
    await b.saveAssignmentPage('spring-2027','M1','# Survey instructions\n\nRead this before submitting.');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key)),c=d.canvas['spring-2027'];
    Object.assign(c.submissions[0],{score:0,grade:'0',cached_due_at:'2027-01-27T14:00:00Z'});
    Object.assign(c.submissions[1],{score:9999,grade:'PRIVATE',posted_at:null,posted_visible:false,excused:true,late_policy_status:'missing'});
    c.enrollments.push({user_id:'98',uni:null,name:'Ambiguous Student',login_id:'duplicate',match_status:'ambiguous',enrollment_states:['active'],section_ids:['20']});
    sessionStorage.setItem(key,JSON.stringify(d));
  });
}
async function quiz(page,fields){await page.evaluate(async fields=>{
  const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key)),c=d.canvas['spring-2027'],m=c.mappings.find(m=>m.site_key==='Q1');
  Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===m.canvas_assignment_id),fields);sessionStorage.setItem(key,JSON.stringify(d));
  await (await import('/assets/materials/demo.js')).createDemo().syncCanvas('spring-2027');
},fields);}
for(const role of ['instructor','grader'])test(`${role} gets only the current Canvas grid and the common status pill in details`,async({page})=>{
  await seed(page);await enter(page,role);await expect(page.locator('.canvas-grid')).toBeVisible();
  await expect(page.getByLabel('Gradebook mode')).toHaveCount(0);await expect(page.locator('#materials-root input,#materials-root textarea')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Save scores|Release|Make visible/})).toHaveCount(0);
  await page.getByRole('button',{name:'Demo Student M1: Done',exact:true}).click();const popup=page.getByRole('dialog',{name:'Canvas submission details'});
  await expect(popup.locator('.canvas-status-pill')).toHaveText('Submitted ✓');await expect(popup).toContainText('Score: 0');await expect(popup).toContainText('Posted:');
  await expect(popup.getByRole('link')).toHaveAttribute('target','_blank');await page.keyboard.press('Escape');await expect(popup).toBeHidden();
  await enter(page,role,'groups');await expect(page.locator('.canvas-group')).toHaveCount(1);await expect(page.locator('#materials-root button,#materials-root input')).toHaveCount(0);
});
test('Canvas roster shows unmatched records first, sections and state; local CSV import is gone and Settings still manages roles',async({page})=>{
  await seed(page);await enter(page,'instructor','roster');
  const rows=page.locator('.canvas-roster tbody tr');await expect(rows.first()).toContainText('ambiguous');await expect(rows.nth(1)).toContainText('unmatched');
  await expect(rows.filter({hasText:'Demo Student'})).toContainText('ab1234');await expect(rows.filter({hasText:'Demo Student'})).toContainText('10');
  await expect(page.getByText('Replace roster from Canvas CSV',{exact:true})).toHaveCount(0);
  await expect(rows.first().getByRole('button')).toHaveCount(0);
  await enter(page,'instructor','settings');await expect(page.locator('#access-lists')).toBeAttached();await expect(page.locator('#student-accounts')).toBeAttached();
});
test('Canvas quiz sync drives attendance, keeps the excuse popup, and never restores an overridden excuse',async({page})=>{
  await seed(page);await enter(page,'instructor','attendance');await cell(page).locator('button').click();
  let popup=page.getByRole('dialog');await popup.getByLabel('Excuse reason').fill('Approved absence');await popup.getByRole('button',{name:'Excuse absence',exact:true}).click();
  await expect(cell(page).locator('.attendance-mark')).toHaveText('EX');
  await quiz(page,{score:0,workflow_state:'graded',submitted_at:null,missing:false,late_policy_status:null});await page.reload();await ready(page);
  await expect(cell(page).locator('.attendance-mark')).toHaveText('✓');await cell(page).locator('button').click();
  popup=page.getByRole('dialog');await expect(popup).toContainText('CourseWorks');await expect(popup.getByRole('button')).toHaveText(['Close']);await popup.getByRole('button',{name:'Close'}).click();
  await quiz(page,{late_policy_status:'missing'});await page.reload();await ready(page);await expect(cell(page).locator('.attendance-mark')).toHaveText('–');
  await enter(page,'grader','attendance');await cell(page).locator('button').click();await expect(page.getByRole('dialog').getByRole('button')).toHaveText(['Close']);
});
test('student polish uses one shared pill, inline due text, linked grade titles and grouped three-column scores',async({page})=>{
  await seed(page);await enter(page,'student','week-1');const block=page.locator('#milestone-1');
  await expect(block.locator('.milestone-title')).toHaveText('Milestone #1: Pre-Class Survey · Due Wed, Jan 27, 9:00 AM · 3 days 4 hrs');
  await expect(block.locator('.canvas-status-pill')).toHaveText('Submitted ✓');
  await expect(block.locator('.canvas-sync-note')).toHaveCSS('font-size','11px');await expect(block.locator('.canvas-sync-note')).toHaveCSS('color','rgb(119, 119, 119)');await expect(block.locator('.canvas-assignment-links a')).toHaveText(['Instructions →','Submit on CourseWorks →']);
  await enter(page,'student','assignments/milestone-1');await expect(page.locator('.canvas-status-pill')).toHaveText('Submitted ✓');await expect(page.locator('.prep-markdown')).toContainText('Survey instructions');
  await enter(page,'student','grades');await expect(page.locator('#my-grades thead th')).toHaveText(['Item','Status','Score']);
  await expect(page.locator('.canvas-grade-group h2')).toHaveText(['Milestones','Quizzes','Participation','Optional tasks']);
  await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('0 / 10');await expect(page.locator('[data-grade-code=M1] a')).toHaveText('Milestone #1: Pre-Class Survey');
  await expect(page.locator('[data-grade-code=M2] .grade-score')).toHaveText('Not posted');await expect(page.locator('[data-grade-code=M2] .canvas-status-pill')).toHaveText('Submitted ✓');
  await expect(page.locator('#materials-root')).not.toContainText(/9999|PRIVATE|Open in CourseWorks|Total/);
});
test('archived site grades remain readable and disabled, and returning to the active term restores the Canvas-only grid',async({page})=>{
  await seed(page);await page.evaluate(async()=>{await (await import('/assets/materials/demo.js')).createDemo().openTerm('Spring 2028');});
  await enter(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await ready(page);
  await expect(page.getByLabel('Gradebook mode')).toHaveValue('legacy');await expect(page.locator('input[data-grade]').first()).toHaveValue('8');await expect(page.locator('input[data-grade]').first()).toBeDisabled();
  await page.locator('[data-grade-cell]').first().focus();await page.keyboard.press('Enter');await expect(page.locator('.grade-panel')).toBeVisible();await expect(page.getByLabel('Score',{exact:true})).toBeDisabled();
  await page.getByLabel('Term',{exact:true}).selectOption('spring-2028');await ready(page);await expect(page.getByLabel('Gradebook mode')).toHaveCount(0);await expect(page.locator('input[data-grade]')).toHaveCount(0);
});
test('failed sync shows unavailable instead of attendance or student grade judgments',async({page})=>{
  await seed(page);await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.canvas['spring-2027'].runs.unshift({status:'failed',started_at:'2027-01-24T10:01:00Z'});sessionStorage.setItem(k,JSON.stringify(d));});
  await enter(page,'student','attendance');await expect(page.locator('.student-attendance-grid tbody tr td:nth-child(3)')).toHaveText(Array(6).fill('Status unavailable'));
  await enter(page,'student','grades');await expect(page.locator('[data-grade-code=M1] .canvas-status-pill')).toHaveText('Status unavailable');
  await enter(page);await expect(page.locator('.canvas-grid tbody td button').first()).toHaveText('Status unavailable');
});
for(const width of [1440,390,320])test(`Canvas tools and shared pills fit the right pane at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});await seed(page);
  for(const [role,slug] of [['student','week-1'],['student','assignments/milestone-1'],['student','grades'],['instructor','gradebook'],['instructor','roster'],['grader','groups']]) {
    await enter(page,role,slug);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`evidence/canvas-c/${slug.replaceAll('/','-')}-${width}.png`,fullPage:true});
  }
});
