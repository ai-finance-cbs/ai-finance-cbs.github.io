import {installArchiveFixture} from './archive-fixture.mjs';
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role,slug)=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const pdf=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nPhase C\n%%EOF')});
test.beforeEach(async({page})=>{
  await installArchiveFixture(page);
  await page.route('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('node_modules/fflate/esm/browser.js','utf8')}));
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
});
async function seed(page) {
  await enter(page,'instructor','gradebook');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for(const id of [2,3,5,6])await b.configureItem(id,{kind:id===6?'link':'file',mode:'group',group_set_id:'demo-set',due_at:'2027-01-26T14:00:00Z'});
    window.moveArchivedMember('ab1234','demo-group-1');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.grades=[];sessionStorage.setItem(key,JSON.stringify(d));
  });
}
async function uploadGroup(page) {
  await seed(page);
  await page.evaluate(()=>window.seedArchivedWork([{item_id:3,group_id:'demo-group-1',file_name:'late.pdf',on_time_path:'archive/on-time.pdf'}]));
}
test('group panel grades snapshot members, retains on-time work, flags overrides and membership changes',async({page})=>{
  await uploadGroup(page);await enter(page,'instructor','gradebook');
  await page.locator('[data-grade-cell="ab1234:3"]').click();
  const panel=page.locator('.grade-panel');await expect(panel).toBeVisible();await expect(panel).toContainText('Late');
  await expect(panel.getByRole('button',{name:'Download last on-time file'})).toBeVisible();
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Download last on-time file'}).click();await download;
  await panel.getByLabel('Score',{exact:true}).fill('7');await panel.getByLabel('Comment',{exact:true}).fill('Group feedback');await panel.getByRole('button',{name:'Grade group',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Group grade saved');
  for(const uni of ['ab1234','cd5678'])await expect(page.getByLabel(`${uni} Milestone #3`,{exact:true})).toHaveValue('7');
  await page.getByLabel('ab1234 Milestone #3',{exact:true}).fill('9');await page.getByRole('button',{name:'Save scores',exact:true}).click();
  await expect(page.locator('[data-grade-cell="ab1234:3"] .override-mark')).toBeVisible();
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();window.moveArchivedMember('ab1234','demo-group-2');});await page.reload();await ready(page);
  await page.locator('[data-grade-cell="ab1234:3"]').click();await expect(panel).toContainText('Now Group 2');
  await expect(panel).toContainText('Second Student');await expect(panel.getByLabel('Comment',{exact:true})).toHaveValue('Group feedback');
});
test('grader panel accepts a score without submission and has no release controls',async({page})=>{
  await seed(page);await enter(page,'grader','gradebook');await expect(page.locator('button.grade-visibility')).toHaveCount(0);
  await page.locator('[data-grade-cell="ab1234:4"]').click();const panel=page.locator('.grade-panel');await expect(panel).toContainText('Not submitted');
  await panel.getByLabel('Score',{exact:true}).fill('0');await panel.getByLabel('Comment',{exact:true}).fill('No work received');await panel.getByRole('button',{name:'Save student grade'}).click();
  await expect(page.getByLabel('ab1234 Milestone #4',{exact:true})).toHaveValue('0');
});
test('Settings manages New York times, linked modes, blocked submitted changes, file category and storage',async({page})=>{
  await uploadGroup(page);await enter(page,'instructor','settings');
  await expect(page.locator('[data-storage-usage]')).toContainText('/ 1 GB');
  await page.locator('#session-times > summary').click();
  for(const [week,date,utc] of [[1,'2027-03-13','2027-03-13T14:00:00.000Z'],[2,'2027-03-15','2027-03-15T13:00:00.000Z']]) {
    await page.getByLabel(`Week ${week} start (New York)`).fill(`${date}T09:00`);await page.getByLabel(`Week ${week} end (New York)`).fill(`${date}T12:00`);
    await page.getByRole('button',{name:`Save Week ${week} times`,exact:true}).click();await expect(page.locator(`#session-${week} [role=status]`)).toHaveText('Session times saved.');
    expect(await page.evaluate(async week=>(await (await import('/assets/materials/demo.js')).createDemo().classData()).sessions.find(s=>s.week===week).starts_at,week)).toBe(utc);
  }
  await page.reload();await ready(page);await page.locator('#session-times > summary').click();await expect(page.getByLabel('Week 2 start (New York)')).toHaveValue('2027-03-15T09:00');
  await page.locator('#submission-settings > summary').click();await page.locator('#submission-settings details').filter({hasText:'M4 ·'}).locator('summary').click();
  const m4=page.locator('#item-4');await m4.getByLabel('Submission mode').selectOption('group');await m4.getByRole('button').click();await expect(m4.locator('[role=status]')).toContainText('Choose a group set');
  await m4.getByLabel('Linked group set').selectOption('demo-set');await m4.getByRole('button').click();await expect(page.locator('[data-admin-status]')).toContainText('Submission settings saved');
  await page.locator('#submission-settings details').filter({hasText:'M3 ·'}).locator('summary').click();const m3=page.locator('#item-3');await m3.getByLabel('Submission mode').selectOption('individual');await m3.getByRole('button').click();await expect(m3.locator('[role=status]')).toContainText('after work has been submitted');
  await page.locator('#lecture-pdfs > summary').click();await expect(page.getByLabel('Week',{exact:true}).locator('option')).toHaveCount(6);
  await page.getByLabel('File title',{exact:true}).fill('Scheduled class file');await page.getByLabel('File category').selectOption('in_class');await page.getByLabel('Release time (New York)',{exact:true}).fill('2027-03-15T09:00');
  await page.getByLabel('Lecture PDF (maximum 20 MB)').setInputFiles(pdf('class.pdf'));await page.getByRole('button',{name:'Upload PDF',exact:true}).click();await expect(page.getByRole('link',{name:'Scheduled class file',exact:true})).toBeVisible();
  const row=await page.evaluate(async()=>(await (await import('/assets/materials/demo.js')).createDemo().files())[0]);expect(row.release_at).toBe('2027-03-15T13:00:00.000Z');expect(row.category).toBe('in_class');expect(row.released).toBe(false);
  await page.goto('/materials/files/');await ready(page);await expect(page).toHaveURL(/settings\/#lecture-pdfs/);
});
test('term controls export before close and leave purging manual; staff can filter archived grades',async({page})=>{
  await seed(page);await enter(page,'instructor','settings');await page.locator('#term-rollover > summary').click();
  await page.getByLabel('New term name').fill('Spring 2028');await page.getByLabel('Archive the current term and open the new term').check();await page.getByRole('button',{name:'Open term',exact:true}).click();
  await expect(page.locator('#term-rollover')).toContainText('Active term: Spring 2028');const archived=page.locator('[data-term="spring-2027"]');
  await expect(archived.getByRole('button',{name:'Close previous term'})).toBeDisabled();
  const download=page.waitForEvent('download');await archived.getByRole('button',{name:'Export grades and submissions'}).click();expect((await download).suggestedFilename()).toBe('spring-2027.zip');
  await expect(archived).toContainText('Export recorded');await archived.getByLabel('I saved the export; end student access').check();await archived.getByRole('button',{name:'Close previous term'}).click();
  await expect(archived).toContainText('closed');await expect(archived.getByRole('button',{name:'Purge stored files'})).toBeDisabled();
  await archived.getByLabel('Delete this closed term’s stored files').check();await archived.getByRole('button',{name:'Purge stored files'}).click();await expect(archived).toContainText('Stored files purged.');
  await page.goto('/materials/gradebook/');await ready(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await expect(page.getByRole('button',{name:'Save scores',exact:true})).toBeDisabled();
  await page.getByLabel('Gradebook item',{exact:true}).selectOption('1');
  await expect(page.getByRole('button',{name:'Save scores',exact:true})).toBeDisabled();
  await expect(page.getByLabel('ab1234 Milestone #1',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'M1 visibility: Visible',exact:true})).toBeDisabled();
  await page.goto('/materials/attendance/');await ready(page);await expect(page.getByRole('button',{name:/Mark all present/})).toHaveCount(0);
});
for(const width of [1440,1280])test(`Phase C screenshots and gradebook fits 17 columns at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await uploadGroup(page);await enter(page,'instructor','gradebook');mkdirSync('evidence/phase-c',{recursive:true});
  const fits=async()=>{expect(await page.locator('.gradebook-grid').evaluate(t=>t.scrollWidth<=t.parentElement.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);};
  const shot=async name=>{await page.evaluate(async()=>{document.activeElement?.blur();window.scrollTo({top:0,left:0,behavior:'instant'});await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);await page.screenshot({path:`evidence/phase-c/${name}-${width}.png`,fullPage:true});};
  await fits();await expect(page.locator('.site-sidebar')).toBeVisible();await shot('gradebook-instructor');
  await page.locator('[data-grade-cell="ab1234:3"]').click();await fits();await shot('gradebook-group-panel');
  await page.goto('/materials/settings/');await ready(page);await page.locator('#session-times > summary').click();await page.locator('#submission-settings > summary').click();await page.locator('#lecture-pdfs > summary').click();await shot('settings');
  await page.goto('/materials/attendance/');await ready(page);await shot('attendance-staff');
  await enter(page,'student','submit');await shot('submit-student');await page.goto('/materials/grades/');await ready(page);await shot('grades-student');
  await expect(page.locator('[data-grade-total]')).toHaveCount(0);await expect(page.locator('.tool-help,.subline')).toHaveCount(0);
  await page.evaluate(()=>{const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.items.push({term_id:'spring-2027',id:17,code:'Q6',title:'Layout capacity check',max_points:3,kind:'none',mode:'individual',released:false});sessionStorage.setItem(key,JSON.stringify(d));});
  await enter(page,'instructor','gradebook');await expect(page.locator('.gradebook-grid thead th')).toHaveCount(19);await fits();
});
test('all class tools fit phones and show no subtitle/help beneath the title',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  for(const [role,slug] of [['instructor','gradebook'],['instructor','attendance'],['instructor','settings'],['instructor','roster'],['instructor','groups'],['student','submit'],['student','grades'],['student','week-3']]){
    await enter(page,role,slug);await expect(page.locator('.page-heading .subline,#materials-root > .tool-help')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
