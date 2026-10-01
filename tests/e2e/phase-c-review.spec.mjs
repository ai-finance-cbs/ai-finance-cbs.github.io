import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role,slug)=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.route('https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('node_modules/fflate/esm/browser.js','utf8')}));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
});
async function seed(page) {
  await enter(page,'instructor','settings');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for(const id of [2,3,5,6])await b.configureItem(id,{kind:id===6?'link':'file',mode:'group',group_set_id:'demo-set',due_at:'2027-01-26T14:00:00Z'});
    await b.chooseGroup('demo-set','demo-group-1','ab1234');
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.grades=[];sessionStorage.setItem(key,JSON.stringify(d));
  });
}
async function prepareArchive(page) {
  await seed(page);
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await b.uploadFile(new File(['%PDF-1.7\nnotes\n%%EOF'],'notes.pdf',{type:'application/pdf'}),{week:1,title:'Exported notes',released:true});
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));
    d.files.push({term_id:'spring-2027',id:'missing',week:2,title:'Missing notes',storage_path:'week-2/missing.pdf',file_size:25});
    d.orphan_files=[{path:'week-1/unreferenced.pdf',size:30}];sessionStorage.setItem(key,JSON.stringify(d));
    await b.openTerm('Spring 2028');
  });
  await page.reload();await ready(page);await page.locator('#term-rollover > summary').click();
}
test('Submit uses one compact row per item, one hint, linked milestone titles, and no optional week or unset due placeholders',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await seed(page);await enter(page,'student','submit');
  await expect(page.locator('.submit-item')).toHaveCount(9);await expect(page.locator('.submission-hint')).toHaveCount(1);
  await expect(page.locator('#submit-M1 h2 a')).toHaveAttribute('href','/materials/week-1/#milestone-1');await expect(page.locator('#submit-FP h2 a')).toHaveAttribute('href','/materials/week-6/#final-prototype');
  for(const code of ['O1','O2','O3']) {const row=page.locator(`#submit-${code}`);await expect(row.locator('a')).toHaveCount(0);await expect(row.locator('.upcoming-meta')).toBeEmpty();await expect(row).not.toContainText(/Week|announced|Instructions/);}
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const first=page.locator('#submit-M1');await first.getByRole('button',{name:'Submit',exact:true}).click();await expect(first.locator('[data-submission-status]')).toHaveText('Choose a file to submit.');await expect(first.locator('[role=status]')).toHaveCount(1);
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('instructor');const d=await b.classData();const i=d.items.find(i=>i.code==='O2');await b.configureItem(i.id,{kind:'file',mode:'individual',group_set_id:null,due_at:'2027-02-03T14:00:00Z'});await b.pickRole('student');});
  await page.reload();await ready(page);await expect(page.locator('#submit-O2 .upcoming-meta')).toContainText('Feb 3');await expect(page.locator('#submit-O2 a')).toHaveCount(0);
});
test('browser download records counts and missing files before closing; orphan list and confirmed cleanup remain separate',async({page})=>{
  await prepareArchive(page);const term=page.locator('#term-spring-2027');await expect(term.getByRole('button',{name:'Close previous term'})).toBeDisabled();
  const download=page.waitForEvent('download');await term.getByRole('button',{name:'Export grades and submissions'}).click();const file=await download;
  const zip=unzipSync(readFileSync(await file.path()));expect(Object.keys(zip).some(name=>name.startsWith('lecture-notes/'))).toBe(true);expect(JSON.parse(strFromU8(zip['manifest.json'])).missing_files).toHaveLength(1);
  await expect(term.locator('[data-export-summary]')).toContainText('1 files · 20 bytes');await expect(term.locator('[data-missing-files]')).toHaveText('1 files missing');
  await term.getByLabel('I saved the export; end student access').check();await expect(term.getByRole('button',{name:'Close previous term'})).toBeEnabled();
  await page.locator('#lecture-pdfs > summary').click();await page.getByRole('button',{name:'List unreferenced files'}).click();await expect(page.locator('[data-orphan-files]')).toContainText('week-1/unreferenced.pdf');
  await page.getByRole('button',{name:'Delete listed files'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('[data-orphan-files]')).toContainText('week-1/unreferenced.pdf');
  await page.getByRole('button',{name:'Delete listed files'}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.locator('[data-admin-status]')).toHaveText('Unreferenced files deleted.');
  await page.getByRole('button',{name:'List unreferenced files'}).click();await expect(page.locator('[data-orphan-files]')).toContainText('0 unreferenced files');
});
for(const width of [1440,1280])test(`review screenshots for compact Submit and Settings at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await seed(page);await enter(page,'student','submit');mkdirSync('evidence/phase-c/round-1',{recursive:true});
  const shot=async name=>{await page.evaluate(async()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});await document.fonts.ready;});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`evidence/phase-c/round-1/${name}-${width}.png`,fullPage:true});};
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);await shot('submit-student');
  await prepareArchive(page);const term=page.locator('#term-spring-2027');const download=page.waitForEvent('download');await term.getByRole('button',{name:'Export grades and submissions'}).click();await download;await expect(term.locator('[data-export-summary]')).toBeVisible();
  await page.locator('#lecture-pdfs > summary').click();await page.getByRole('button',{name:'List unreferenced files'}).click();await expect(page.locator('[data-orphan-files]')).toContainText('unreferenced.pdf');await shot('settings');
});
