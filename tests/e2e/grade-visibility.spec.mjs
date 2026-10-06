import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role = 'instructor', slug = 'gradebook') => {
  await page.goto(`/materials/${slug}/?fakeauth=${role}`); await ready(page);
};
const release = (page, code, state) => page.getByRole('button', { name:`${code} visibility: ${state}`, exact:true });
const prompt = page => page.getByRole('group', { name:'Release confirmation' });
const row = page => page.locator('tr[data-student="demo student ab1234"]');
const flag = (page, id) => page.evaluate(async id => (await (await import('/assets/materials/demo.js')).createDemo().classData()).items.find(i => i.id === id).released, id);
const screenshot = async (page, name) => {
  await page.evaluate(async () => {
    document.activeElement?.blur(); await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path:`evidence/phase-f/${name}-1440.png`, fullPage:true });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', { get:() => ({ base:'', url:'', key:'' }), set:() => {} }));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
  await page.setViewportSize({ width:1440, height:900 });
  mkdirSync('evidence/phase-f', { recursive:true });
});

async function seed(page) {
  await enter(page);
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    await b.saveGrades([[1,8],[2,7],[6,25],[7,0],[13,10],[14,10],[15,10]].map(([item_id,score]) => ({ uni:'ab1234', item_id, score, comment:`Feedback ${item_id}` })));
    await b.releaseItem(13,true); await b.releaseItem(15,true);
  });
  await page.reload(); await ready(page);
}

test('column flags style every cell and distinguish visible totals from all recorded scores', async ({ page }) => {
  await seed(page);
  const items = await page.evaluate(async () => (await (await import('/assets/materials/demo.js')).createDemo().classData()).items);
  for (const item of items) {
    await expect(page.locator(`[data-release-item="${item.id}"]`)).toHaveText(item.released ? 'Visible' : 'Hidden');
    const cells = page.locator(`[data-grade-cell$=":${item.id}"]`);
    for (const cell of await cells.all()) await expect(cell).toHaveAttribute('data-release-state', item.released ? 'visible' : 'hidden');
  }
  const hidden = row(page).locator('[data-grade-cell="ab1234:2"] input');
  await expect(hidden).toHaveCSS('color','rgb(119, 119, 119)'); await expect(hidden).toHaveCSS('background-color','rgb(247, 247, 247)');
  await expect(hidden).toHaveCSS('font-style','normal');
  await expect(release(page,'M1','Visible')).toHaveCSS('background-color','rgb(140, 47, 57)');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23');
  await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  await expect(page.locator('.gradebook-grid thead th').last()).toHaveText('Total (visible)incl. hidden');
  await page.locator('#grade-legend > summary').click();
  await expect(page.locator('[data-visibility-legend]')).toHaveText('Hidden: scores and comments stay private. Visible: students can see their scores and comments.');
  await page.locator('#grade-legend > summary').click();
  await screenshot(page,'gradebook-visibility');
  await page.getByLabel('Gradebook item').selectOption('2');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23');
  await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  await enter(page,'student','grades');
  await expect(page.locator('[data-grade-total]')).toHaveCount(0);
  await expect(page.locator('[data-grade-code=M2]')).not.toContainText('Feedback 2');
});

test('release requires inline confirmation, Cancel preserves privacy, and panel copy follows both states', async ({ page }) => {
  await seed(page); await page.locator('[data-grade-cell="ab1234:2"]').click();
  const note = page.locator('[data-panel-visibility]');
  await expect(note).toHaveText('Hidden from students. Visible after you release M2.');
  expect(await note.evaluate(n => n.getBoundingClientRect().bottom <= n.parentElement.querySelector('label').getBoundingClientRect().top)).toBe(true);
  await screenshot(page,'gradebook-hidden-panel');
  await release(page,'M2','Hidden').click(); await expect(prompt(page)).toContainText('Show M2 scores and comments to students?');
  expect(await flag(page,2)).toBe(false);
  await screenshot(page,'gradebook-release-confirm');
  await prompt(page).getByRole('button',{name:'Cancel',exact:true}).click(); expect(await flag(page,2)).toBe(false);
  await release(page,'M2','Hidden').click(); await prompt(page).getByRole('button',{name:'Show scores',exact:true}).click();
  await expect(release(page,'M2','Visible')).toHaveAttribute('aria-pressed','true'); expect(await flag(page,2)).toBe(true);
  await expect(note).toHaveText('Visible to students now.');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('30'); await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  await expect(row(page).locator('[data-grade-cell="ab1234:2"] input')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.reload(); await ready(page); await expect(release(page,'M2','Visible')).toBeVisible();
  await enter(page,'student','grades'); await expect(page.locator('[data-grade-code=M2]')).not.toContainText('Feedback 2');
  await enter(page); await release(page,'M2','Visible').click();
  await expect(release(page,'M2','Hidden')).toHaveAttribute('aria-pressed','false'); await expect(prompt(page)).toBeHidden();
  await page.locator('[data-grade-cell="ab1234:2"]').click(); await expect(note).toHaveText('Hidden from students. Visible after you release M2.');
});

test('graders read both column states and the correct panel message without release controls', async ({ page }) => {
  await seed(page); await enter(page,'grader');
  await expect(page.locator('button.grade-visibility')).toHaveCount(0);
  await expect(page.locator('span.grade-visibility')).toHaveCount(16);
  await expect(page.locator('[data-release-item="1"]')).toHaveText('Visible'); await expect(page.locator('[data-release-item="2"]')).toHaveText('Hidden');
  await page.locator('[data-grade-cell="ab1234:2"]').click();
  await expect(page.locator('[data-panel-visibility]')).toHaveText('Hidden from students until the instructor releases M2.');
  await expect(page.getByLabel('Score',{exact:true})).toBeEnabled();
  await page.locator('[data-grade-cell="ab1234:1"]').click(); await expect(page.locator('[data-panel-visibility]')).toHaveText('Visible to students now.');
  await expect(row(page).locator('[data-visible-total]')).toHaveText('23'); await expect(row(page).locator('[data-all-total]')).toHaveText('55');
  const denial = await page.evaluate(async () => { try { await (await import('/assets/materials/demo.js')).createDemo().releaseItem(2,true); return 'allowed'; } catch(e) { return e.message; } });
  expect(denial).toContain('Instructor access required');
});

test('unsaved scores and a rejected release keep the previous visibility and allow recovery', async ({ page }) => {
  const source = readFileSync('assets/materials/class-demo.js','utf8');
  await page.route('**/assets/materials/class-demo.js', route => route.fulfill({ contentType:'text/javascript', body:source.replace('async releaseItem(id, released) {', 'async releaseItem(id, released) { if (globalThis.failRelease) throw new Error("Release failed. Try again.");') }));
  await seed(page); await release(page,'M2','Hidden').click();
  const input = page.getByLabel('ab1234 Milestone #2',{exact:true}); await input.click(); await input.fill('6');
  await prompt(page).getByRole('button',{name:'Show scores',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Save scores before changing release status.'); expect(await flag(page,2)).toBe(false);
  await expect(input).toHaveValue('6'); await release(page,'M2','Hidden').click(); await expect(prompt(page)).toBeHidden();
  await page.getByRole('button',{name:'Save scores',exact:true}).click(); await expect(page.locator('[data-admin-status]')).toHaveText('Scores saved.');
  await page.evaluate(() => { globalThis.failRelease = true; });
  await release(page,'M2','Hidden').click(); await prompt(page).getByRole('button',{name:'Show scores',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Release failed. Try again.');
  await expect(release(page,'M2','Hidden')).toBeEnabled(); expect(await flag(page,2)).toBe(false);
  await expect(page.locator('[data-panel-visibility]')).toHaveText('Hidden from students. Visible after you release M2.');
  await page.evaluate(() => { globalThis.failRelease = false; });
  await release(page,'M2','Hidden').click(); await prompt(page).getByRole('button',{name:'Show scores',exact:true}).click();
  await expect(release(page,'M2','Visible')).toBeEnabled(); await expect(input).toHaveValue('6');
  await page.evaluate(() => { globalThis.failRelease = true; }); await release(page,'M2','Visible').click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Release failed. Try again.'); await expect(release(page,'M2','Visible')).toBeEnabled();
});
