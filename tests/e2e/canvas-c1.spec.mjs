import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role='instructor',slug='attendance')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const week=page=>page.locator('.student-attendance-grid tbody tr').first();
async function quiz(page,fields) {
  await enter(page);
  await page.evaluate(async fields=>{
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key)),c=d.canvas['spring-2027'];
    const m=c.mappings.find(m=>m.site_key==='Q1');
    Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===m.canvas_assignment_id),fields);
    sessionStorage.setItem(key,JSON.stringify(d));await (await import('/assets/materials/demo.js')).createDemo().syncCanvas('spring-2027');
  },fields);
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-03-03T12:00:00Z'));mkdirSync('evidence/canvas-c/c1',{recursive:true});
});
test('student and preview cannot infer unposted quiz scores from attendance rows or paper assignment status',async({page})=>{
  await enter(page,'student');await expect(week(page).locator('td').nth(1)).toHaveText('Pending');
  const initial=await week(page).textContent();
  for(const fields of [{score:0,workflow_state:'graded',submitted_at:null},{missing:true,late_policy_status:'missing'}]) {
    await quiz(page,fields);await page.reload();await ready(page);
    await expect(page.getByLabel('ab1234 Week 1 attendance',{exact:true}).locator('button')).toHaveText(fields.score===0?'✓':'–');
    await enter(page,'student');await expect(week(page)).toHaveText(initial);await expect(week(page)).not.toContainText(/Present|Absent|Quiz/);
    await enter(page,'student','grades');await expect(page.locator('[data-grade-code=Q1] .canvas-status-pill')).toHaveText('Not posted');await expect(page.locator('[data-grade-code=Q1] .grade-score')).toHaveText('Not posted');
    await enter(page);await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await ready(page);
    await expect(week(page)).toHaveText(initial);await expect(page.locator('[data-preview-banner]')).toBeVisible();
  }
  await page.setViewportSize({width:390,height:900});await page.screenshot({path:'evidence/canvas-c/c1/pending-preview-390.png',fullPage:true});
});
test('posting reveals attendance, unposting hides it, and an instructor excuse stays visible',async({page})=>{
  await quiz(page,{score:0,posted_at:'2027-03-02T14:00:00Z'});await enter(page,'student');await expect(week(page)).toContainText('Present');
  await quiz(page,{posted_at:null});await enter(page,'student');await expect(week(page)).toContainText('Pending');
  await quiz(page,{score:null});await page.evaluate(async()=>{await (await import('/assets/materials/demo.js')).createDemo().saveAttendance(1,[{uni:'ab1234',status:'excused',excuse_reason:'PRIVATE reason'}]);});
  await enter(page,'student');await expect(week(page)).toContainText('Excused');await expect(page.locator('#materials-root')).not.toContainText('PRIVATE');
  await page.screenshot({path:'evidence/canvas-c/c1/excused-student.png',fullPage:true});
});
test('a graded workflow without a receipt is not Submitted; the four retired client methods are absent',async({page})=>{
  await enter(page);
  await page.evaluate(async()=>{
    const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k)),c=d.canvas['spring-2027'];
    Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id==='100'),{submitted_at:null,posted_at:null,workflow_state:'graded'});sessionStorage.setItem(k,JSON.stringify(d));
    await (await import('/assets/materials/demo.js')).createDemo().syncCanvas('spring-2027');
  });
  await enter(page,'student','week-1');await expect(page.locator('#milestone-1 .canvas-status-pill')).not.toHaveText('Submitted ✓');
  await enter(page,'student','grades');await expect(page.locator('[data-grade-code=M1] .canvas-status-pill')).not.toHaveText('Submitted ✓');
  expect(await page.evaluate(async()=>{
    const demo=(await import('/assets/materials/demo.js')).createDemo();window.supabase={createClient:()=>({})};
    const real=await (await import('/assets/materials/supabase.js')).createBackend({url:'synthetic',key:'synthetic'});
    return ['gradeGroup','saveGrades','releaseItem','replaceRoster'].every(name=>!(name in demo)&&!(name in real));
  })).toBe(true);
});
