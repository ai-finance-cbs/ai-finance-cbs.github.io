import {installArchiveFixture} from './archive-fixture.mjs';
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role = 'instructor', slug = 'gradebook') => {
  await page.goto(`/materials/${slug}/?fakeauth=${role}`); await ready(page);
};
const release = (page, code, state) => page.getByLabel(`${code} visibility: ${state}`, {exact:true});
const prompt = page => page.getByRole('group', { name:'Release confirmation' });
const row = page => page.locator('tr[data-student="demo student ab1234"]');
const flag = (page, id) => page.evaluate(async id => (await (await import('/assets/materials/demo.js')).createDemo().classData('spring-2027')).items.find(i => i.id === id).released, id);
const screenshot = async (page, name) => {
  await page.evaluate(async () => {
    document.activeElement?.blur(); await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path:`evidence/phase-f/${name}-1440.png`, fullPage:true });
};

test.beforeEach(async ({ page }) => {
  await installArchiveFixture(page);
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', { get:() => ({ base:'', url:'', key:'' }), set:() => {} }));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
  await page.setViewportSize({ width:1440, height:900 });
  mkdirSync('evidence/phase-f', { recursive:true });
});

async function seed(page) {
  await enter(page);
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    window.seedArchivedGrades([[1,8],[2,7],[6,25],[7,0],[13,10],[14,10],[15,10]].map(([item_id,score]) => ({ uni:'ab1234', item_id, score, comment:`Feedback ${item_id}` })));
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));for(const i of d.items)if([13,15].includes(i.id))i.released=true;sessionStorage.setItem(key,JSON.stringify(d));await b.openTerm('Spring 2028');
  });
  await page.reload(); await ready(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await ready(page);
}

test('archived column flags style every cell and distinguish visible totals from all recorded scores', async ({ page }) => {
  await seed(page);
  const items = await page.evaluate(async () => (await (await import('/assets/materials/demo.js')).createDemo().classData('spring-2027')).items);
  for (const item of items) {
    await expect(page.locator(`[data-release-item="${item.id}"]`)).toHaveText(item.released ? 'Visible' : 'Hidden');
    const cells = page.locator(`[data-grade-cell$=":${item.id}"]`);
    for (const cell of await cells.all()) await expect(cell).toHaveAttribute('data-release-state', item.released ? 'visible' : 'hidden');
  }
  const hidden = row(page).locator('[data-grade-cell="ab1234:2"]');
  await expect(hidden).toHaveCSS('color','rgb(119, 119, 119)'); await expect(hidden).toHaveCSS('background-color','rgb(247, 247, 247)');
  await expect(hidden).toHaveCSS('font-style','normal');
  await expect(release(page,'M1','Visible')).toHaveCSS('background-color','rgb(140, 47, 57)');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23');
  await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  await expect(page.locator('.gradebook-grid thead th').last()).toHaveText('Total (visible)incl. hidden');
  await page.locator('#grade-legend > summary').click();
  await expect(page.locator('#grade-legend')).toContainText('Archived scores and comments are read-only. Hidden items remain private.');
  await page.locator('#grade-legend > summary').click();
  await screenshot(page,'gradebook-visibility');
  await page.getByLabel('Gradebook item').selectOption('2');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23');
  await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  await enter(page,'student','grades');
  await expect(page.locator('[data-grade-total]')).toHaveCount(0);
  await expect(page.locator('[data-grade-code=M2]')).not.toContainText('Feedback 2');
});



test('graders read archived column states and the correct panel message without release controls', async ({ page }) => {
  await seed(page); await enter(page,'grader');
  await expect(page.locator('button.grade-visibility')).toHaveCount(0);
  await expect(page.locator('span.grade-visibility')).toHaveCount(16);
  await expect(page.locator('[data-release-item="1"]')).toHaveText('Visible'); await expect(page.locator('[data-release-item="2"]')).toHaveText('Hidden');
  await page.locator('[data-grade-cell="ab1234:2"]').click();
  await expect(page.locator('[data-panel-visibility]')).toHaveText('Hidden from students.');
  await expect(page.locator('[data-archived-score]')).toBeVisible();
  await page.locator('[data-grade-cell="ab1234:1"]').click(); await expect(page.locator('[data-panel-visibility]')).toHaveText('Visible to students now.');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23'); await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  expect(await page.evaluate(async () => 'releaseItem' in (await import('/assets/materials/demo.js')).createDemo())).toBe(false);
});
