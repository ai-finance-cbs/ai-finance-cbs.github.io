import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role='student',slug='submit')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const pdf={name:'working-setup.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nlocal work\n%%EOF')};
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
  mkdirSync('evidence/phase-e',{recursive:true});
});

for(const slug of ['week-4','submit']) test(`${slug}: progress updates under the filename; rejection clears it and enables retry`,async({page})=>{
  // Hold each synthetic progress event long enough to inspect and capture its visible state.
  await page.route('**/assets/materials/submission-demo.js',route=>route.fulfill({contentType:'text/javascript',body:readFileSync('assets/materials/submission-demo.js','utf8').replace('setTimeout(resolve,120)','setTimeout(resolve,400)')}));
  await page.setViewportSize({width:1440,height:900});await enter(page,'student',slug);await page.evaluate(()=>document.fonts.ready);
  const item=page.locator(slug==='submit'?'#submit-M4':'#milestone-4');
  await item.getByLabel('Submission file').setInputFiles(pdf);await item.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(item.locator('[data-upload-percent]')).toHaveText('Uploading 24%');
  await expect(item.getByRole('progressbar')).toHaveAttribute('value','24');
  await expect(item.getByRole('button',{name:'Choose file'})).toBeDisabled();await expect(item.getByRole('button',{name:'Submit',exact:true})).toBeDisabled();
  await expect(item.locator('[data-upload-percent]')).toHaveText('Uploading 62%');
  const positions=await item.evaluate(n=>({name:n.querySelector('[data-selected-file]')?.getBoundingClientRect().bottom || n.querySelector('[data-submission-status]').getBoundingClientRect().bottom,bar:n.querySelector('progress').getBoundingClientRect().top}));
  expect(positions.bar).toBeGreaterThanOrEqual(positions.name);
  if(slug==='submit')await page.screenshot({path:'evidence/phase-e/submit-mid-upload-1440.png',fullPage:true});
  await page.evaluate(()=>{const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));for(const p of d.pending_uploads)p.expires_at='2020-01-01';sessionStorage.setItem(key,JSON.stringify(d));});
  await expect(item.locator('[data-submission-status]')).toHaveText('Pending upload expired or superseded.');
  await expect(item.locator('[data-upload-progress]')).toBeHidden();
  await expect(item.getByRole('button',{name:'Choose file'})).toBeEnabled();await expect(item.getByRole('button',{name:'Submit',exact:true})).toBeEnabled();
  await item.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(item.locator('[data-submission-status]')).toContainText('Submitted · working-setup.pdf');
  await expect(item.locator('[data-upload-progress]')).toBeHidden();await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toBeVisible();
});

test('file deletion confirms inline, preserves Cancel, resets status, and permits a fresh upload',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await enter(page);
  const item=page.locator('#submit-M4');await item.getByLabel('Submission file').setInputFiles(pdf);await item.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(item.locator('[data-submission-status]')).toContainText('Submitted');
  await item.getByRole('button',{name:'Delete submission',exact:true}).click();
  await expect(item.locator('[data-delete-confirm]')).toContainText('Delete working-setup.pdf?');
  await page.screenshot({path:'evidence/phase-e/submit-delete-confirm-1440.png',fullPage:true});
  await item.getByRole('button',{name:'Cancel',exact:true}).click();await expect(item.locator('[data-submission-status]')).toContainText('Submitted');
  await item.getByRole('button',{name:'Delete submission',exact:true}).click();await item.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(item.locator('[data-submission-status]')).toHaveText('Not submitted');await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);
  await page.reload();await ready(page);await expect(item.locator('[data-submission-status]')).toHaveText('Not submitted');
  await item.getByLabel('Submission file').setInputFiles(pdf);await item.getByRole('button',{name:'Submit',exact:true}).click();await expect(item.locator('[data-submission-status]')).toContainText('Submitted');
  await page.goto('/materials/week-4/');await ready(page);await page.getByRole('button',{name:'Delete submission',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Not submitted');
});

test('group link deletion respects deadlines, grades, preview, and archived terms in UI and demo calls',async({page})=>{
  await enter(page,'instructor');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();await b.configureItem(6,{kind:'link',mode:'group',group_set_id:'demo-set',due_at:'2027-01-26T14:00:00Z'});
    await b.chooseGroup('demo-set','demo-group-1','ab1234');await b.chooseGroup('demo-set','demo-group-1','cd5678');
    await b.pickRole('student');await b.submitLink(6,'https://example.test/video');
  });
  await enter(page);const item=page.locator('#submit-FP');await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toBeVisible();
  await page.clock.setFixedTime(new Date('2027-01-26T14:00:00Z'));await page.reload();await ready(page);
  await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);
  const denied=()=>page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo(),s=(await b.classData()).submissions.find(s=>s.item_id===6);try{await b.deleteSubmission(s.id);return 'allowed';}catch(e){return e.message;}});
  expect(await denied()).toContain('deadline');
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('grader');await b.gradeGroup(6,'demo-group-1',0);await b.pickRole('student');});
  await page.reload();await ready(page);await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);expect(await denied()).toContain('Graded, locked');
  await enter(page,'instructor','week-6');await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.gradeGroup(6,'demo-group-1',null);});
  await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await expect(page.locator('[data-preview-banner]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);expect(await denied()).toContain('read-only');
  await page.locator('[data-preview-exit]').click();await enter(page);
  await item.getByRole('button',{name:'Delete submission',exact:true}).click();await item.getByRole('button',{name:'Delete',exact:true}).click();await expect(item.locator('[data-submission-status]')).toHaveText('Not submitted');
  await item.getByLabel('Prototype HTTPS link').fill('https://example.test/new');await item.getByRole('button',{name:'Submit',exact:true}).click();await expect(item.locator('[data-submission-status]')).toContainText('Submitted');
  await page.evaluate(()=>{const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.terms[0].status='archived-readable';sessionStorage.setItem(key,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);expect(await denied()).toContain('read-only');
});

test('twelve speakers group by week, keep all fields and notes, and preserve inline editing',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await enter(page,'instructor','speakers');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for(const s of await b.speakers())await b.deleteSpeaker(s.id);
    for(let n=1;n<=12;n++)await b.saveSpeaker({name:`Guest ${String(n).padStart(2,'0')}`,affiliation:'Example Finance',topic:'Research with AI',week:n%6+1,status:['Idea','Contacted','Confirmed'][n%3],contact:`guest${n}@example.test`,notes:'Synthetic speaker planning note.'});
  });
  await page.reload();await ready(page);await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.speaker-row')).toHaveCount(12);
  await expect(page.locator('.speaker-week')).toHaveCount(7);
  for (let week=1;week<=6;week++) {
    const group=page.locator(`[data-speaker-week="${week}"]`); await expect(group.locator('.speaker-row')).toHaveCount(2);
    await expect(group.locator('.speaker-notes')).toHaveText(['Synthetic speaker planning note.','Synthetic speaker planning note.']);
  }
  await expect(page.locator('#materials-root table')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'evidence/phase-e/speakers-1440.png',fullPage:true});
  const first=page.locator('.speaker-row').first();await first.getByRole('button',{name:'Edit',exact:true}).click();await first.getByLabel('Topic').fill('Updated topic');await first.getByRole('button',{name:'Save speaker'}).click();
  await page.getByLabel('Filter speakers').fill('Updated topic');await expect(page.locator('.speaker-row')).toHaveCount(1);
  await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
