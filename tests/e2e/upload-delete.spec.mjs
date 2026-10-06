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
  await expect(page.locator('.speaker-row').filter({hasText:'Updated topic'})).toHaveCount(1);
  await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
