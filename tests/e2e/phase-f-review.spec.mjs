import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter = async (page,role,slug) => { await page.goto(`/materials/${slug}/?fakeauth=${role}`); await ready(page); };
const pdf = {name:'group-work.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nReview\n%%EOF')};
const asStudent = async (page,uni,slug) => {
  await page.evaluate(uni => sessionStorage.setItem('b8403-demo-user-v1',JSON.stringify({email:`${uni}@columbia.edu`,uni})),uni);
  await page.goto(`/materials/${slug}/`); await ready(page);
};
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
});

for (const [kind,id,code,week] of [['file',2,'M2',2],['link',6,'FP',6]]) test(`group ${kind} Delete belongs to the latest uploader on Submit and week pages`, async ({page}) => {
  await enter(page,'instructor','submit');
  await page.evaluate(async ({kind,id}) => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await b.configureItem(id,{kind,mode:'group',group_set_id:'demo-set',due_at:'2099-01-01'});
    await b.chooseGroup('demo-set','demo-group-1','ab1234');
  },{kind,id});
  await enter(page,'student','submit');
  const item=page.locator(`#submit-${code}`);
  const submit=async replacement => {
    if(kind==='file')await item.getByLabel('Submission file').setInputFiles(pdf);
    else await item.getByLabel('Prototype HTTPS link').fill(`https://example.test/${replacement?'peer':'original'}`);
    await item.getByRole('button',{name:replacement?'Replace submission':'Submit',exact:true}).click();
    await expect(item.locator('[data-submission-status]')).toContainText('Submitted');
  };
  await submit(false);await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toBeVisible();
  for(const slug of [`week-${week}`,'submit']) {
    await asStudent(page,'cd5678',slug);
    await expect(page.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Replace submission',exact:true})).toBeEnabled();
  }
  const denial=await page.evaluate(async id => {
    const b=(await import('/assets/materials/demo.js')).createDemo(),s=(await b.classData()).submissions.find(s=>s.item_id===id);
    try {await b.deleteSubmission(s.id);return 'allowed';}catch(e){return e.message;}
  },id);
  expect(denial).toBe('Only the member who uploaded this file can delete it. You can replace it.');
  await submit(true);await expect(item.getByRole('button',{name:'Delete submission',exact:true})).toBeVisible();
  await asStudent(page,'ab1234',`week-${week}`);await expect(page.getByRole('button',{name:'Delete submission',exact:true})).toHaveCount(0);
  await asStudent(page,'cd5678',`week-${week}`);await page.getByRole('button',{name:'Delete submission',exact:true}).click();
  await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.locator('[data-submission-status]')).toHaveText('Not submitted');
});

test('review Markdown payloads stay escaped in the rendered notes, including bold and headings', async ({page}) => {
  await enter(page,'instructor','preparation/week-1');await page.getByRole('button',{name:'Edit',exact:true}).click();
  const payloads=['[x](javascript:alert(1))','[x](https://a"onmouseover=...)','<img src=x onerror="window.prepXss=1">'];
  await page.getByLabel('Week 1 notes').fill(payloads.flatMap(s=>[s,`**${s}**`,`# ${s}`,`## **${s}**`]).join('\n\n'));
  await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('[data-prep-status]')).toContainText('Saved');
  await page.reload();await ready(page);
  const rendered=page.locator('[data-prep-markdown]');
  for(const payload of payloads)await expect(rendered).toContainText(payload);
  await expect(rendered.locator('a,img,script,[onerror],[onmouseover]')).toHaveCount(0);
  await expect(rendered.locator('strong')).toHaveCount(6);await expect(rendered.locator('h1,h2')).toHaveCount(6);
  expect(await page.evaluate(()=>window.prepXss)).toBeUndefined();
});

test('all six week pages use main’s neutral section boxes without per-week tint classes or variables', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});mkdirSync('evidence/phase-f/review-1',{recursive:true});
  for(let week=1;week<=6;week++) {
    await enter(page,'instructor',`week-${week}`);
    await expect(page.locator('body')).toHaveClass(/week-page/);
    await expect(page.locator('.week-tint,[class~="week-1"],[class~="week-2"],[class~="week-3"],[class~="week-4"],[class~="week-5"],[class~="week-6"]')).toHaveCount(0);
    const blocks=page.locator('body.week-page #materials-root > .week-block');expect(await blocks.count()).toBeGreaterThan(0);
    for(const block of await blocks.all())await expect(block).toHaveCSS('background-color','rgb(250, 250, 250)');
    expect(await page.locator('body').evaluate(n=>getComputedStyle(n).getPropertyValue('--wk'))).toBe('');
  }
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'evidence/phase-f/review-1/week-neutral-sections-1440.png',fullPage:true});
});
