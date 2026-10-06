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

test('review Markdown payloads stay escaped in the rendered notes, including bold and headings', async ({page}) => {
  await enter(page,'instructor','preparation/week-1');const notes=page.locator('[data-prep-section="Other notes"]');await notes.getByRole('button',{name:'Edit Other notes',exact:true}).click();
  const payloads=['[x](javascript:alert(1))','[x](https://a"onmouseover=...)','<img src=x onerror="window.prepXss=1">'];
  await page.getByLabel('Other notes',{exact:true}).fill(payloads.flatMap(s=>[s,`**${s}**`,`# ${s}`,`## **${s}**`]).join('\n\n'));
  await notes.getByRole('button',{name:'Save',exact:true}).click();await expect(notes.locator('[data-prep-status]')).toContainText('Saved');
  await page.reload();await ready(page);
  const rendered=notes.locator('[data-prep-markdown]');
  for(const payload of payloads)await expect(rendered).toContainText(payload);
  await expect(rendered.locator('a,img,script,[onerror],[onmouseover]')).toHaveCount(0);
  await expect(rendered.locator('strong')).toHaveCount(6);await expect(rendered.locator('h1,h2')).toHaveCount(6);
  expect(await page.evaluate(()=>window.prepXss)).toBeUndefined();
});

test('all six week pages colour cards by type, never by week', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});mkdirSync('evidence/phase-f/review-1',{recursive:true});
  for(let week=1;week<=6;week++) {
    await enter(page,'instructor',`week-${week}`);
    await expect(page.locator('body')).toHaveClass(/week-page/);
    await expect(page.locator('.week-tint,[class~="week-1"],[class~="week-2"],[class~="week-3"],[class~="week-4"],[class~="week-5"],[class~="week-6"]')).toHaveCount(0);
    const blocks=page.locator('body.week-page #materials-root > .week-block');expect(await blocks.count()).toBeGreaterThan(0);
    // Design B: colour follows the card type (same on every week), never the week number
    await expect(page.locator('#due-before-class')).toHaveCSS('background-color','rgb(243, 246, 251)');
    await expect(page.locator('#lecture-notes')).toHaveCSS('background-color','rgb(242, 247, 252)');
    await expect(page.locator('#required-readings')).toHaveCSS('background-color','rgb(246, 247, 249)');
    expect(await page.locator('body').evaluate(n=>getComputedStyle(n).getPropertyValue('--wk'))).toBe('');
  }
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'evidence/phase-f/review-1/week-neutral-sections-1440.png',fullPage:true});
});
