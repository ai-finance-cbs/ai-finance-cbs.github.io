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
    for(const id of [2,3,5,6])window.configureArchivedItem(id,{kind:id===6?'link':'file',mode:'group',group_set_id:'demo-set',due_at:'2027-01-26T14:00:00Z'});
    window.moveArchivedMember('ab1234','demo-group-1');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.grades=[];sessionStorage.setItem(key,JSON.stringify(d));
  });
}
async function uploadGroup(page) {
  await seed(page);
  await page.evaluate(()=>window.seedArchivedWork([{item_id:3,group_id:'demo-group-1',file_name:'late.pdf',on_time_path:'archive/on-time.pdf'}]));
}
test('archived group panel retains on-time work and blocks score edits',async({page})=>{
  await uploadGroup(page);await page.evaluate(async()=>{await (await import('/assets/materials/demo.js')).createDemo().openTerm('Spring 2028');});
  await enter(page,'instructor','gradebook');await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await ready(page);
  await page.locator('[data-grade-cell="ab1234:3"]').click();const panel=page.locator('.grade-panel');
  await expect(panel).toContainText('Late');await expect(panel.locator('[data-archived-score]')).toBeVisible();await expect(panel.locator('input,textarea,form')).toHaveCount(0);
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Download last on-time file'}).click();await download;
});
test('Settings manages New York times, file category and storage without retired submission controls',async({page})=>{
  await uploadGroup(page);await enter(page,'instructor','settings');
  await expect(page.locator('[data-storage-usage]')).toContainText('/ 1 GB');
  await page.locator('#session-times > summary').click();
  for(const [week,date,utc] of [[1,'2027-03-13','2027-03-13T14:00:00.000Z'],[2,'2027-03-15','2027-03-15T13:00:00.000Z']]) {
    await page.getByLabel(`Week ${week} start (New York)`).fill(`${date}T09:00`);await page.getByLabel(`Week ${week} end (New York)`).fill(`${date}T12:00`);
    await page.getByRole('button',{name:`Save Week ${week} times`,exact:true}).click();await expect(page.locator(`#session-${week} [role=status]`)).toHaveText('Session times saved.');
    expect(await page.evaluate(async week=>(await (await import('/assets/materials/demo.js')).createDemo().classData()).sessions.find(s=>s.week===week).starts_at,week)).toBe(utc);
  }
  await page.reload();await ready(page);await page.locator('#session-times > summary').click();await expect(page.getByLabel('Week 2 start (New York)')).toHaveValue('2027-03-15T09:00');
  await expect(page.locator('#submission-settings')).toHaveCount(0);
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
  await page.goto('/materials/gradebook/');await ready(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await expect(page.getByRole('button',{name:'Save scores',exact:true})).toHaveCount(0);
  await page.getByLabel('Gradebook item',{exact:true}).selectOption('1');
  await expect(page.getByRole('button',{name:'Save scores',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-grade-cell="ab1234:1"]')).toHaveText('–');
  await expect(page.locator('[data-release-item="1"]')).toHaveText('Visible');
  await page.goto('/materials/attendance/');await ready(page);await expect(page.getByRole('button',{name:/Mark all present/})).toHaveCount(0);
});
test('all class tools fit phones and show no subtitle/help beneath the title',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  for(const [role,slug] of [['instructor','gradebook'],['instructor','attendance'],['instructor','settings'],['instructor','roster'],['instructor','groups'],['student','submit'],['student','grades'],['student','week-3']]){
    await enter(page,role,slug);await expect(page.locator('.page-heading .subline,#materials-root > .tool-help')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
