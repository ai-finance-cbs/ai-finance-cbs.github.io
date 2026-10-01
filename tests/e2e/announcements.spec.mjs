import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, section = 'week-1') => {
  await page.goto(`/materials/${section}/?fakeauth=${role}`); await ready(page);
};
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({base:'',url:'',key:''}), set: () => {},
  }));
  await page.clock.setFixedTime(new Date('2027-01-17T15:00:00Z'));
});
test('instructor posts, edits, and deletes short announcements with literal text', async ({page}) => {
  await enter(page,'instructor','settings');
  const editor = page.locator('#announcements-editor'); await editor.locator('> summary').click();
  await page.locator('#announcement-new').getByLabel('Title (optional)').fill('Class update');
  await page.locator('#announcement-new').getByLabel('Announcement text').fill('<img src=x onerror=alert(1)>\nBring your notes.');
  await page.getByRole('button',{name:'Post announcement',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement posted.');
  await page.goto('/materials/week-1/'); await ready(page);
  await expect(page.locator('#week-announcements')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#week-announcements img')).toHaveCount(0);
  await page.goto('/materials/settings/'); await ready(page); await editor.locator('> summary').click();
  await editor.locator('.announcement-editor summary').click();
  await editor.locator('.announcement-editor').getByLabel('Announcement text').fill('Updated class notice.');
  await page.getByRole('button',{name:'Save announcement',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement saved.');
  await editor.locator('.announcement-editor summary').click();
  await page.getByRole('button',{name:'Delete announcement',exact:true}).click();
  await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement deleted.');
  await page.goto('/materials/week-1/'); await ready(page);
  await expect(page.locator('#week-announcements')).toHaveCount(0);
});

test('gradebook uses codes, a closed legend, and code CSV exports that can be reimported', async ({page}) => {
  await enter(page,'instructor','gradebook');
  const legend = page.locator('#grade-legend');
  await expect(legend).not.toHaveAttribute('open',''); await legend.locator('summary').click();
  await expect(legend).toContainText('Q1 → In-class quiz 1 → 3 points');
  await expect(legend).toContainText('Optional tasks are capped at 15 points total');
  await expect(legend).toContainText('A quiz score marks attendance present');
  const q1 = page.locator('.gradebook-grid thead th[title="In-class quiz 1"]');
  await expect(q1).toContainText('Q1'); await expect(q1.locator('.grade-max')).toHaveText('/3');
  await expect(page.getByLabel('Gradebook item').locator('option').nth(7)).toHaveText('Q1');
  const downloading = page.waitForEvent('download'); await page.getByRole('button',{name:'Export gradebook CSV',exact:true}).click();
  const csv = readFileSync(await (await downloading).path(),'utf8');
  expect(csv.split('\r\n')[0]).toBe('"UNI","Name","M1","M2","M3","M4","M5","FP","Q1","Q2","Q3","Q4","Q5","PA","O1","O2","O3","O4","Optional capped","Total"');
  await page.getByLabel('Gradebook item').selectOption('7');
  const singleDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Export In-class quiz 1 CSV',exact:true}).click();
  expect(readFileSync(await (await singleDownload).path(),'utf8').split('\r\n')[0]).toBe('"UNI","Q1"');
  await page.locator('#grade-import summary').click();
  await page.getByLabel('Grade CSV',{exact:true}).setInputFiles({name:'grades.csv',mimeType:'text/csv',buffer:Buffer.from('UNI,Q1\nab1234,0')});
  await page.getByRole('button',{name:'Preview grade import',exact:true}).click();
  await page.getByRole('button',{name:'Import scores',exact:true}).click();
  await expect(page.getByLabel('ab1234 In-class quiz 1',{exact:true})).toHaveValue('0');
  await enter(page,'grader','gradebook');
  await expect(page.locator('button.grade-visibility')).toHaveCount(0);
  await expect(page.locator('#grade-legend')).not.toHaveAttribute('open','');
});
