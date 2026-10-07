import {installArchiveFixture} from './archive-fixture.mjs';
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role,slug='assignments/milestone-1')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const pdf={name:'survey.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nSynthetic\n%%EOF')};
test.beforeEach(async({page})=>{
  await installArchiveFixture(page);
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.install({time:new Date('2027-01-24T10:00:00Z')});
  await page.clock.setFixedTime(new Date('2027-01-24T10:00:00Z'));
  await page.setViewportSize({width:1440,height:1000});mkdirSync('evidence/phase-h',{recursive:true});
});
async function seed(page){
  await enter(page,'instructor');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    window.seedArchivedGrades([{uni:'ab1234',item_id:1,score:null}]);
    window.configureArchivedItem(1,{kind:'file',mode:'individual',group_set_id:null,due_at:'2027-01-27T14:00:00Z'});
    await b.syncCanvas('spring-2027');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.canvas['spring-2027'].submissions.find(s=>s.assignment_id==='100'&&s.user_id==='1').cached_due_at='2027-01-27T14:00:00Z';sessionStorage.setItem(key,JSON.stringify(d));
    const rows=await b.assignments();await b.saveAssignment({...rows.find(a=>a.id===1),title:'Pre-Class Survey'});
    for(const code of ['M1','M2','M3','M4','M5','FP','O1','O2','O3'])await b.saveAssignmentPage('spring-2027',code,'# Synthetic instructions\n\n**Demo** and *example*\n\n- First step\n- Second step\n\n[Reference](https://example.test/)\n\n<script>window.assignmentXss=1</script>\n<img src=x onerror=alert(1)>\n[Unsafe](javascript:alert)');
  });
}
test('week milestone uses the full name, trimmed content, instructions link, and a minute-updating deadline',async({page})=>{
  await seed(page);await enter(page,'student','week-1');const box=page.locator('#milestone-1');
  await expect(box.locator('h3')).toContainText('Milestone #1: Pre-Class Survey');
  await expect(box.locator('.due-line')).toHaveText('Due Wed, Jan 27, 9:00 AM · 3 days 4 hrs');
  await expect(box.locator('.due-line')).toHaveCSS('color',await box.locator('h3').evaluate(n=>getComputedStyle(n).color));
  await expect(box.locator('[data-milestone-state]')).toHaveText('Submitted ✓');
  await expect(box).not.toContainText(/Deliverable|Graded on|Individual|Synthetic local example/);
  await expect(page.locator('#materials-root')).not.toContainText(/\b(?:M[1-5]|FP|O[1-4])\b/);
  await expect(box.getByRole('link',{name:'Instructions →'})).toHaveAttribute('href','/materials/assignments/milestone-1/');
  await page.screenshot({path:'evidence/phase-h/week-milestone.png',fullPage:true});
  await page.clock.setFixedTime(new Date('2027-01-27T12:55:00Z'));await page.clock.runFor(60000);
  await expect(box.locator('.due-line')).toContainText('1 hrs 5 min');
  await page.clock.setFixedTime(new Date('2027-01-27T12:56:00Z'));await page.clock.runFor(60000);
  await expect(box.locator('.due-line')).toContainText('1 hrs 4 min');
  await page.clock.setFixedTime(new Date('2027-01-27T14:00:00Z'));await page.clock.runFor(60000);
  await expect(box.locator('.due-line')).toContainText('Past due');await expect(box.locator('.due-line')).toHaveClass(/past-due/);
});
test('student instructions render safe Markdown and summary beside CourseWorks links',async({page})=>{
  await seed(page);await enter(page,'student');
  await expect(page.locator('.page-heading h1')).toHaveText('Milestone #1: Pre-Class Survey');
  const root=page.locator('#materials-root');await expect(root.locator('.due-line')).toContainText('3 days 4 hrs remaining');
  await expect(root.locator('.assignment-mode .mode-option.is-active')).toHaveText('Individual');
  await expect(root.locator('.prep-markdown strong')).toHaveText('Demo');await expect(root.locator('.prep-markdown em')).toHaveText('example');
  await expect(root.locator('.prep-markdown li')).toHaveText(['First step','Second step']);
  await expect(root.getByRole('link',{name:'Reference'})).toHaveAttribute('target','_blank');
  await expect(root.locator('.prep-markdown img,.prep-markdown script')).toHaveCount(0);expect(await page.evaluate(()=>window.assignmentXss)).toBeUndefined();
  await expect(root.locator('.assignment-summary')).toHaveCount(0);
  await expect(root.getByRole('button',{name:/^Edit /})).toHaveCount(0);
  await page.screenshot({path:'evidence/phase-h/assignment-student.png',fullPage:true});
  await expect(page.getByLabel('Submission file')).toHaveCount(0);
  await expect(root.getByRole('link',{name:'Submit on CourseWorks →'})).toBeVisible();
  await enter(page,'student','grades');await expect(root).not.toContainText(/\b(?:M[1-5]|FP|O[1-4]|Q[1-5]|PA)\b/);
  await expect(root).toContainText('Milestone #1: Pre-Class Survey');await expect(root).toContainText('Final Prototype');
  await expect(root.locator('[data-grade-code^=O]')).toHaveCount(4);
});
test('instructor edits inline, cancels, saves, reloads, and receives unsaved navigation and sign-out warnings',async({page})=>{
  await seed(page);await enter(page,'instructor');
  await page.getByRole('button',{name:'Edit introduction'}).click();const input=page.getByLabel('Introduction text');
  await input.fill('# Unsaved');await page.screenshot({path:'evidence/phase-h/assignment-instructor-edit.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toBeHidden();await expect(page.locator('.prep-markdown')).toContainText('Synthetic instructions');
  await page.getByRole('button',{name:'Edit introduction'}).click();await input.fill('# Saved assignment\n\nNew **instructions**.');
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect(input).toBeHidden();await expect(page.locator('.prep-markdown')).toContainText('Saved assignment');
  await page.reload();await ready(page);await expect(page.locator('.prep-markdown')).toContainText('Saved assignment');
  await page.getByRole('button',{name:'Edit introduction'}).click();await input.fill('Discarded draft');
  await page.locator('.topnav').getByRole('link',{name:'Groups',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unsaved changes');
  await page.getByRole('button',{name:'Keep editing'}).click();await expect(input).toHaveValue('Discarded draft');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unsaved changes');await page.getByRole('button',{name:'Keep editing'}).click();
  const dialog=page.waitForEvent('dialog');const reload=page.evaluate(()=>{location.reload();});const warning=await dialog;expect(warning.type()).toBe('beforeunload');await warning.dismiss();await reload;
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');
  await expect(page.getByRole('button',{name:/^Edit /})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose file',exact:true})).toHaveCount(0);
});
test('assignment sections render as separate panels and each saves on its own',async({page})=>{
  await seed(page);await enter(page,'instructor');
  await page.getByRole('button',{name:'Edit introduction'}).click();
  await page.getByLabel('Introduction text').fill('Intro line.\n\n## AI Policy\n\nPolicy text.\n\n## Grading\n\nTen points.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.assignment-panel')).toHaveCount(3);
  await expect(page.locator('[data-assignment-section="AI Policy"] .prep-markdown')).toHaveText('Policy text.');
  await page.getByRole('button',{name:'Edit Grading'}).click();await page.getByLabel('Grading text').fill('Twelve points.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.reload();await ready(page);
  await expect(page.locator('[data-assignment-section="Grading"] .prep-markdown')).toHaveText('Twelve points.');
  await expect(page.locator('[data-assignment-section="AI Policy"] .prep-markdown')).toHaveText('Policy text.');
  await expect(page.locator('[data-assignment-section="Introduction"] .prep-markdown')).toHaveText('Intro line.');
});
test('grader is read-only, auditors see only shared pages, and menu visibility follows sharing',async({page})=>{
  await seed(page);await enter(page,'grader');await expect(page.locator('.prep-markdown')).toContainText('Synthetic instructions');
  await expect(page.getByRole('button',{name:/^Edit /})).toHaveCount(0);await expect(page.getByRole('link',{name:'Open in CourseWorks →'})).toBeVisible();
  const reject=()=>page.evaluate(async()=>{try{await (await import('/assets/materials/demo.js')).createDemo().saveAssignmentPage('spring-2027','M1','Forbidden');return false;}catch{return true;}});
  expect(await reject()).toBe(true);
  await enter(page,'auditor');await expect(page.locator('.prep-markdown')).toContainText('Synthetic instructions');await expect(page.locator('.submission-box')).toHaveCount(0);expect(await reject()).toBe(true);
  await expect(page.locator('.subnav-top.assignment-nav a:visible .subnav-label')).toHaveText(['Milestone #1']);
  for(const slug of ['milestone-2','final-prototype','optional-tasks']){await enter(page,'auditor',`assignments/${slug}`);await expect(page.locator('#materials-root')).toHaveText('This assignment is not available for your role.');}
  await enter(page,'instructor');await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();const row=(await b.assignments()).find(a=>a.id===1);await b.saveAssignment({...row,auditor_visible:false});});
  await enter(page,'auditor');await expect(page.locator('.topnav').getByRole('link',{name:'Assignments',exact:true})).toBeHidden();await expect(page.locator('.prep-markdown')).toHaveCount(0);
  for(const role of ['unlisted']){await enter(page,role);await expect(page.locator('.prep-markdown,textarea')).toHaveCount(0);}
});
test('assignment landing preserves old anchors; all optional tasks have separate safe editors',async({page})=>{
  await seed(page);
  for(const [anchor,slug] of [['','milestone-1'],['#milestone-3','milestone-3'],['#week-5','milestone-5'],['#milestone-6','final-prototype'],['#final-prototype','final-prototype']]){
    await page.goto(`/materials/assignments/?fakeauth=student${anchor}`);await ready(page);expect(new URL(page.url()).pathname).toBe(`/materials/assignments/${slug}/`);expect(new URL(page.url()).hash).toBe(anchor);
  }
  await enter(page,'instructor','assignments/optional-tasks');await expect(page.locator('.assignment-page')).toHaveCount(3);
  const second=page.locator('#optional-task-2');await second.getByRole('button',{name:'Edit introduction'}).click();await second.locator('textarea').fill('Second optional draft');
  await page.locator('.topnav').getByRole('link',{name:'Groups',exact:true}).click();await expect(second.getByRole('alert')).toContainText('Unsaved changes');await second.getByRole('button',{name:'Keep editing'}).click();
  await second.getByRole('button',{name:'Save',exact:true}).click();await page.reload();await ready(page);await expect(second.locator('.prep-markdown')).toHaveText('Second optional draft');await expect(page.locator('#optional-task-1 .prep-markdown')).toContainText('Synthetic instructions');
});
for(const width of [1280,390,320])test(`student assignment pages fit at ${width}px`,async({page})=>{
  await seed(page);await page.setViewportSize({width,height:1000});
  for(const slug of ['week-1','assignments/milestone-1','assignments/optional-tasks','submit','grades']){
    await enter(page,'student',slug);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#materials-root')).not.toContainText(/\b(?:M[1-5]|FP|O[1-4])\b/);
  }
});
