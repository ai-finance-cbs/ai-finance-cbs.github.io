import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, section) => {
  await page.goto(`/materials/${section}/?fakeauth=${role}`);
  await ready(page);
};
test.beforeEach(async ({ page }) => {
  // These browser tests use synthetic records and never contact hosted Supabase.
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({ base: '', url: '', key: '' }), set: () => {},
  }));
});

test('compact attendance keeps simple overrides, class totals, filters, without whole-class batch actions', async ({ page }) => {
  await enter(page, 'grader', 'attendance');
  const filter = page.getByRole('searchbox', { name: 'Filter by name or UNI' });
  const cell = page.getByLabel('ab1234 Week 1 attendance', { exact: true });
  await expect(cell.locator('option')).toHaveText(['Quiz / clear', 'Present', 'Absent', 'Excused']);
  await expect(page.locator('.student-count')).toHaveText('4 students');
  await filter.fill('AB1234');
  await expect(page.locator('.student-count')).toHaveText('1 of 4 students');
  for (const [value, totals] of [['present', '1P0A0E'], ['absent', '0P1A0E'], ['excused', '0P0A1E']]) {
    await cell.selectOption(value);
    await expect(page.locator('[data-admin-status]')).toHaveText('Attendance saved.');
    await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(totals);
    await expect(filter).toHaveValue('AB1234');
  }
  await expect(page.getByRole('button', { name: /Mark all present/ })).toHaveCount(0);
  await page.evaluate(async () => { const b=(await import('/assets/materials/demo.js')).createDemo(); await b.saveAttendance(1,[{uni:'cd5678',status:'present'},{uni:'ef9012',status:'present'}]); });
  await cell.selectOption('');
  await expect(cell).toHaveValue('');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText('2P0A0E');
  await filter.fill('no such student');
  await expect(page.locator('.empty-filter')).toBeVisible();
  await expect(page.locator('.student-count')).toHaveText('0 of 4 students');
  await filter.fill('Second');
  await expect(page.locator('tr[data-student]:visible')).toHaveCount(1);
  await expect(page.locator('tr[data-student]:visible')).toContainText('cd5678');
  await expect(page.locator('.topbar [data-demo-tag]')).toHaveCount(1);
  await expect(page.locator('#materials-root')).not.toContainText('Local demo');
  // Replacing a roster retains historical records, which must not inflate current class totals.
  await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo();
    await b.pickRole('instructor');
    const { roster } = await b.adminData();
    await b.replaceRoster(roster.filter(r => r.uni !== 'cd5678'));
  });
  await enter(page, 'grader', 'attendance');
  await expect(page.locator('.student-count')).toHaveText('3 students');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText('1P0A0E');
});

test('a rejected attendance save restores the previous select and permits a retry', async ({ page }) => {
  await enter(page, 'grader', 'attendance');
  const cell = page.getByLabel('ab1234 Week 2 attendance', { exact: true });
  await cell.selectOption('excused');
  await expect(page.locator('[data-admin-status]')).toHaveText('Attendance saved.');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'b8403-demo-state-v3') {
        Storage.prototype.setItem = original;
        throw new Error('Test save rejected.');
      }
      return original.call(this, key, value);
    };
  });
  await cell.selectOption('absent');
  await expect(page.locator('[data-admin-status]')).toHaveText('Test save rejected.');
  await expect(cell).toHaveValue('excused');
  await expect(cell).toBeEnabled();
  await expect(page.getByLabel('Week 2 totals', { exact: true })).toHaveText('0P0A1E');
  await cell.selectOption('absent');
  await expect(page.locator('[data-admin-status]')).toHaveText('Attendance saved.');
  await expect(page.getByLabel('Week 2 totals', { exact: true })).toHaveText('0P1A0E');
});

test('gradebook keyboard entry and filtering retain unsaved scores and show recorded totals', async ({ page }) => {
  await enter(page, 'instructor', 'gradebook');
  const first = page.getByLabel('ab1234 Milestone #1', { exact: true });
  const second = page.getByLabel('ab1234 Milestone #2', { exact: true });
  await first.fill('7');
  await first.press('Tab');
  await expect(second).toBeFocused();
  await second.fill('4');
  await second.press('ArrowDown');
  await expect(page.getByLabel('cd5678 Milestone #2', { exact: true })).toBeFocused();
  await page.getByRole('searchbox').fill('Third');
  const third = page.getByLabel('ef9012 Milestone #2', { exact: true });
  await third.fill('5');
  await third.press('ArrowDown');
  await expect(third).toBeFocused();
  await expect(third).toHaveValue('5');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Scores saved.');
  await expect(page.getByRole('searchbox')).toHaveValue('Third');
  await page.getByRole('searchbox').fill('ab1234');
  await expect(first).toHaveValue('7');
  await expect(second).toHaveValue('4');
  await expect(page.locator('tr[data-student]:visible td').last()).toHaveText('11');
  await page.getByLabel('Gradebook item', { exact: true }).selectOption('7');
  await expect(page.locator('input[data-grade]:visible')).toHaveCount(1);
  await expect(page.getByLabel('Release In-class quiz 1', { exact: true })).toBeVisible();
});

test('preview pill stays inside the header beside the role and keeps long names contained', async ({ page }) => {
  await enter(page, 'instructor', 'attendance');
  await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo();
    const { roster } = await b.adminData();
    roster[0].name = 'Demo Student With A Deliberately Long Name For Layout Review';
    await b.replaceRoster(roster);
  });
  await page.reload(); await ready(page);
  await page.locator('[data-view-select]').selectOption('ab1234');
  await expect(page.locator('[data-preview-banner]')).toBeVisible();
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const bounds = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { header: rect('.topbar'), badge: rect('[data-role]'), pill: rect('[data-preview-banner]'),
        fits: document.documentElement.scrollWidth <= innerWidth,
        clipped: document.querySelector('[data-preview-name]').scrollWidth > document.querySelector('[data-preview-name]').clientWidth };
    });
    expect(bounds.fits).toBe(true);
    expect(bounds.pill.right).toBeLessThanOrEqual(bounds.header.right);
    expect(bounds.pill.bottom).toBeLessThanOrEqual(bounds.header.bottom);
    expect(bounds.pill.left).toBeGreaterThan(bounds.badge.right);
    expect(Math.abs((bounds.pill.top + bounds.pill.bottom) / 2 - (bounds.badge.top + bounds.badge.bottom) / 2)).toBeLessThan(3);
    expect(bounds.clipped).toBe(true);
    await expect(page.locator('#materials-root select')).toHaveCount(0);
  }
  await page.locator('[data-preview-exit]').click();
  await expect(page.locator('[data-role]')).toHaveText('Instructor');
  await expect(page.getByLabel('ab1234 Week 1 attendance')).toBeVisible();
});

test('compact screens at desktop and phone sizes, with sticky headers and student columns', async ({ page }) => {
  mkdirSync('evidence/compact-ui', { recursive: true });
  await enter(page, 'instructor', 'attendance');
  // A larger synthetic class makes row density and both scroll directions reviewable.
  await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo();
    const { roster } = await b.adminData();
    roster.push(...Array.from({ length: 24 }, (_, i) => ({ uni: `qa${1000 + i}`, name: `Review Student ${String(i + 1).padStart(2, '0')}` })));
    await b.replaceRoster(roster);
    const students = (await b.classData()).roster;
    await b.setSessionDate(1, '2027-01-25');
    await b.setSessionDate(2, '2027-02-01');
    await b.saveGrades(students.map(r => ({ uni: r.uni, item_id: 7, score: 2 })));
    await b.saveAttendance(1, [{ uni: 'cd5678', status: 'absent' }, { uni: 'ef9012', status: 'excused' }]);
    await b.saveAttendance(2, students.slice(0, 12).map(r => ({ uni: r.uni, status: 'present' })));
    await b.uploadFile(new File(['%PDF-1.4 synthetic local example'], 'demo.pdf', { type: 'application/pdf' }), { title: 'Week 1 lecture notes', week: 1, auditor_visible: false });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const section of ['attendance', 'gradebook', 'roster', 'files', 'settings']) {
      await enter(page, 'instructor', section);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (['attendance', 'gradebook', 'roster'].includes(section)) {
        const grid = page.locator('.class-grid-wrap').first();
        const geometry = await grid.evaluate(w => {
          const t = w.querySelector('table');
          const row = t.querySelector('[data-student]');
          const before = row.firstElementChild.getBoundingClientRect().left;
          w.scrollTop = 180; w.scrollLeft = 180;
          return { rowHeight: row.getBoundingClientRect().height, before,
            left: row.firstElementChild.getBoundingClientRect().left,
            top: t.tHead.rows[0].cells[1].getBoundingClientRect().top,
            containerTop: w.getBoundingClientRect().top,
            font: getComputedStyle(row.querySelector('td')).fontFamily };
        });
        expect(geometry.rowHeight).toBeGreaterThanOrEqual(32);
        expect(geometry.rowHeight).toBeLessThanOrEqual(36);
        expect(Math.abs(geometry.left - geometry.before)).toBeLessThan(1);
        expect(Math.abs(geometry.top - geometry.containerTop)).toBeLessThan(2);
        expect(geometry.font).toContain('Helvetica');
        await grid.evaluate(w => { w.scrollTop = 0; w.scrollLeft = 0; });
      }
      if (section === 'settings') {
        await expect(page.locator('#materials-root > details')).toHaveCount(9);
        await expect(page.locator('#materials-root > details[open]')).toHaveCount(0);
      }
      await page.screenshot({ path: `evidence/compact-ui/${section}-${width}.png`, fullPage: true });
    }
    await page.locator('[data-view-select]').selectOption('test1');
    await expect(page).toHaveURL(/attendance\/$/);
    await expect(page.locator('[data-preview-banner]')).toBeVisible();
    await page.screenshot({ path: `evidence/compact-ui/preview-${width}.png`, fullPage: true });
    await page.goto('/materials/groups/'); await ready(page);
    await expect(page.locator('#materials-root button')).toHaveCount(0);
    await page.screenshot({ path: `evidence/compact-ui/preview-groups-${width}.png`, fullPage: true });
    await enter(page, 'student', 'attendance');
    await expect(page.locator('[data-preview-banner]')).toBeHidden();
    await expect(page.locator('#materials-root select')).toHaveCount(0);
    await page.screenshot({ path: `evidence/compact-ui/student-attendance-${width}.png`, fullPage: true });
    await page.goto('/materials/groups/'); await ready(page);
    const groupAction = await page.getByRole('button', { name: 'Join Group 1 in Week 2 lab', exact: true }).boundingBox();
    expect(groupAction.x + groupAction.width).toBeLessThan(width);
    await page.screenshot({ path: `evidence/compact-ui/student-groups-${width}.png`, fullPage: true });
    await enter(page, 'grader', 'gradebook');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: `evidence/compact-ui/grader-gradebook-${width}.png`, fullPage: true });
  }
});
