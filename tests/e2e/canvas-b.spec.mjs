import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role='student',slug='week-1')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.install({time:new Date('2027-01-24T10:00:00Z')});await page.clock.setFixedTime(new Date('2027-01-24T10:00:00Z'));
  mkdirSync('evidence/canvas-b',{recursive:true});
});
async function seed(page){
  await enter(page,'instructor','settings');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();await b.syncCanvas('spring-2027');
    await b.saveAssignment({...((await b.assignments()).find(a=>a.id===1)),title:'Pre-Class Survey'});
    await b.saveAssignmentPage('spring-2027','M1','# Survey instructions\n\n**Read this** before submitting.');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key)),c=d.canvas['spring-2027'];
    Object.assign(c.submissions.find(s=>s.assignment_id==='100'&&s.user_id==='1'),{cached_due_at:'2027-01-27T14:00:00Z',score:0,grade:'0'});
    Object.assign(c.submissions.find(s=>s.assignment_id==='101'&&s.user_id==='1'),{score:9876,grade:'SECRET',posted_visible:false,posted_at:null});
    c.groups.push({id:'11',category_id:'1',category_name:'Prototype',name:'Private other group'},{id:'12',category_id:'2',category_name:'Discussion',name:'Discussion A'});
    c.group_members.push({group_id:'11',user_id:'3',name:'Private third teammate'},{group_id:'12',user_id:'1',name:'Demo Student'});
    sessionStorage.setItem(key,JSON.stringify(d));
  });
}
test('week and assignment views keep instructions and full names with personal due dates and CourseWorks links',async({page})=>{
  await seed(page);await enter(page);const milestone=page.locator('#milestone-1');
  await expect(milestone.locator('h3')).toContainText('Milestone #1: Pre-Class Survey');
  await expect(milestone.locator('.due-line')).toHaveText('Due Wed, Jan 27, 9:00 AM · 3 days 4 hrs');
  await expect(milestone.locator('[data-submission-status]')).toHaveText('Submitted ✓');
  const link=milestone.getByRole('link',{name:'Submit on CourseWorks →'});
  await expect(link).toHaveAttribute('href','https://courseworks2.columbia.edu/courses/240315/assignments/100');await expect(link).toHaveAttribute('target','_blank');
  await expect(milestone.locator('[data-canvas-health]')).toContainText('Last synced:');
  await expect(page.locator('input[type=file],.submission-box')).toHaveCount(0);
  await milestone.getByRole('link',{name:'Instructions →'}).click();await ready(page);
  await expect(page.locator('.prep-markdown')).toContainText('Survey instructions');await expect(page.locator('.page-heading h1')).toHaveText('Milestone #1: Pre-Class Survey');
  await expect(page.locator('[data-submission-status]')).toHaveText('Submitted ✓');await expect(page.getByRole('link',{name:'Submit on CourseWorks →'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Choose file|Delete submission|^Submit$/})).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2027-01-27T12:55:00Z'));await page.clock.runFor(60000);await expect(page.locator('.due-line')).toContainText('1 hrs 5 min remaining');
});
test('Grades shows posted zero and Not posted, without hidden grades, comments, or local totals',async({page})=>{
  await seed(page);await enter(page,'student','grades');
  await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('0 / 10');
  await expect(page.locator('[data-grade-code=M2] .grade-score')).toHaveText('Not posted');
  await expect(page.locator('[data-grade-total],.grade-comment')).toHaveCount(0);
  await expect(page.locator('#materials-root')).not.toContainText(/9876|SECRET|Total|bonus|\bQ[1-6]\b|\bM[1-5]\b/);
  await expect(page.locator('[data-canvas-health]')).toContainText('Last synced:');
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.canvas['spring-2027'].submissions[0].posted_visible=false;d.canvas['spring-2027'].submissions[0].posted_at=null;sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('Not posted');
});
test('Groups shows only own sets and member names; staff see all groups without edit controls',async({page})=>{
  await seed(page);await enter(page,'student','groups');
  await expect(page.locator('.canvas-group-set h2')).toHaveText(['Prototype','Discussion']);
  await expect(page.locator('#materials-root')).toContainText('Second Student');
  await expect(page.locator('#materials-root')).not.toContainText(/Private other group|Private third teammate|ab1234|cd5678|Seats|capacity/);
  await expect(page.locator('#materials-root button,#materials-root input,#materials-root select')).toHaveCount(0);
  for(const role of ['instructor','grader']){await enter(page,role,'groups');await expect(page.locator('#materials-root')).toContainText('Private other group');await expect(page.locator('#materials-root button,#materials-root input,#materials-root select')).toHaveCount(0);}
});
test('preview receives selected student results; auditors have instructions but no personal records',async({page})=>{
  await seed(page);await enter(page,'instructor','assignments/milestone-1');
  await page.getByLabel('View as student',{exact:true}).selectOption('cd5678');await ready(page);
  await expect(page.locator('[data-submission-status]')).toHaveText('Late');await expect(page.getByRole('button',{name:'Edit instructions'})).toHaveCount(0);
  await page.goto('/materials/grades/');await ready(page);await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('8 / 10');
  await enter(page,'auditor','assignments/milestone-1');await expect(page.locator('.prep-markdown')).toContainText('Survey instructions');
  await expect(page.locator('[data-canvas-health],[data-submission-status],.courseworks-link')).toHaveCount(0);
  for(const slug of ['grades','groups']){await enter(page,'auditor',slug);await expect(page.locator('#materials-root')).toContainText('does not have access');await expect(page.locator('[data-canvas-health]')).toHaveCount(0);}
});
test('Submit redirects to Assignments, preserves anchors and demo role, and has no menu entry',async({page})=>{
  await page.goto('/materials/submit/?fakeauth=student#milestone-3');await ready(page);
  await expect(page).toHaveURL(/\/materials\/assignments\/milestone-3\/#milestone-3$/);
  await expect(page.locator('[data-role]')).toHaveText('Student');await expect(page.locator('.topnav').getByRole('link',{name:'Submit',exact:true})).toHaveCount(0);
});
test('delayed sync is labelled; failures withhold judgments, grades and groups until a success',async({page})=>{
  await seed(page);
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.canvas['spring-2027'].course.last_synced_at='2027-01-24T09:29:00Z';sessionStorage.setItem(k,JSON.stringify(d));});
  await enter(page);await expect(page.locator('[data-canvas-health]')).toContainText('Updates delayed');await expect(page.locator('[data-submission-status]')).toHaveText('Submitted ✓');
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.canvas['spring-2027'].runs.forEach(r=>r.started_at='2027-01-24T09:29:00Z');d.canvas['spring-2027'].runs.unshift({status:'failed',started_at:'2027-01-24T09:59:00Z'});sessionStorage.setItem(k,JSON.stringify(d));});
  for(const slug of ['week-1','assignments/milestone-1','grades','groups']){
    await enter(page,'student',slug);await expect(page.locator('[data-canvas-health]')).toContainText('Status unavailable');
    await expect(page.locator('#materials-root')).not.toContainText(/\bDone\b|\bMissing\b|\bLate\b|8 \/ 10|Second Student/);
  }
});
test('network failure shows Status unavailable while assignment instructions remain readable',async({page})=>{
  await seed(page);
  await page.route('**/assets/materials/canvas-demo.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('async canvasStudentData(term) {',"async canvasStudentData(term) { throw new Error('offline');")});});
  await enter(page,'student','assignments/milestone-1');await expect(page.locator('.prep-markdown')).toContainText('Survey instructions');await expect(page.locator('[data-submission-status]')).toHaveText('Status unavailable');
});
for(const width of [1440,390,320])test(`Canvas student views stay in the right pane at ${width}px`,async({page})=>{
  await seed(page);await page.setViewportSize({width,height:1000});
  for(const slug of ['week-1','assignments/milestone-1','grades','groups']){
    await enter(page,'student',slug);const root=await page.locator('#materials-root').boundingBox();expect(root.x).toBeGreaterThanOrEqual(width>819?240:0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`evidence/canvas-b/${slug.replaceAll('/','-')}-${width}.png`,fullPage:true});
  }
});
