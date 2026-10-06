import {installArchiveFixture} from './archive-fixture.mjs';
import { test, expect } from '@playwright/test';
const openCell = async (page, cell) => { await cell.locator('.attendance-mark').click(); return page.getByRole('dialog'); };
import { mkdirSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, section) => {
  await page.goto(`/materials/${section}/?fakeauth=${role}`);
  await ready(page);
};
test.beforeEach(async ({ page }) => {
  await installArchiveFixture(page);
  // These browser tests use synthetic records and never contact hosted Supabase.
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({ base: '', url: '', key: '' }), set: () => {},
  }));
});

test('compact read-only attendance keeps totals and filters without batch actions', async ({ page }) => {
  await enter(page, 'grader', 'attendance');
  await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await window.seedCanvasScores([{uni:'cd5678',item_id:7,score:0},{uni:'ef9012',item_id:7,score:2}]);
  });
  await page.reload(); await ready(page);
  const filter = page.getByRole('searchbox', { name: 'Filter by name or UNI' });
  await expect(page.locator('.attendance-grid select, .attendance-action, .attendance-edit-toggle, #attendance-import')).toHaveCount(0);
  await expect(page.locator('.student-count')).toHaveText('4 students');
  await filter.fill('AB1234');
  await expect(page.locator('.student-count')).toHaveText('1 of 4 students');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 2Absent (\d+|—)Excused 0$/);
  await expect(page.getByRole('button', { name: /Mark all present/ })).toHaveCount(0);
  await filter.fill('no such student');
  await expect(page.locator('.empty-filter')).toBeVisible();
  await expect(page.locator('.student-count')).toHaveText('0 of 4 students');
  await filter.fill('Second');
  await expect(page.locator('tr[data-student]:visible')).toHaveCount(1);
  await expect(page.locator('tr[data-student]:visible')).toContainText('cd5678');
  await expect(page.locator('.topbar [data-demo-tag]')).toHaveCount(1);
  await expect(page.locator('#materials-root')).not.toContainText('Local demo');
  // Historical records must not inflate current class totals after roster replacement.
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    await b.pickRole('instructor');
    const { roster } = await b.adminData();
    window.seedRoster(roster.filter(r => r.uni !== 'cd5678'));
  });
  await enter(page, 'grader', 'attendance');
  await expect(page.locator('.student-count')).toHaveText('3 students');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 1Absent (\d+|—)Excused 0$/);
});

test('a rejected excuse save keeps the reason and permits a retry', async ({ page }) => {
  await enter(page, 'instructor', 'attendance');
  const cell = page.getByLabel('ab1234 Week 2 attendance', { exact: true });
  const dialog = await openCell(page, cell);
  await dialog.getByRole('textbox').fill('Approved absence');
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
  await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Test save rejected.');
  await expect(dialog.getByRole('textbox')).toHaveValue('Approved absence');
  await expect(dialog.getByRole('button', { name: 'Excuse absence', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Week 2 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 0$/);
  await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Absence excused.');
  await expect(page.getByLabel('Week 2 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 1$/);
});



test('preview pill stays inside the header beside the role and keeps long names contained', async ({ page }) => {
  await enter(page, 'instructor', 'attendance');
  await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo();
    const { roster } = await b.adminData();
    roster[0].name = 'Demo Student With A Deliberately Long Name For Layout Review';
    window.seedRoster(roster);
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
    window.seedRoster(roster);
    const students = (await b.classData()).roster;
    await b.setSessionTimes(1, '2027-01-25T14:00:00Z', '2027-01-25T17:00:00Z');
    await b.setSessionTimes(2, '2027-02-01T14:00:00Z', '2027-02-01T17:00:00Z');
    await window.seedCanvasScores(students.map(r => ({ uni: r.uni, item_id: 7, score: 2 })));
    await window.seedCanvasScores([{uni:'cd5678',item_id:7,score:null},{uni:'ef9012',item_id:7,score:null}]);
    await b.saveAttendance(1, [{ uni: 'ef9012', status: 'excused', excuse_reason: 'Approved absence' }]);
    await window.seedCanvasScores(students.slice(0, 12).map(r => ({ uni: r.uni, item_id: 8, score: 0 })));
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
          const row = t.querySelector('tbody tr:not(.attendance-totals)');
          const before = row.firstElementChild.getBoundingClientRect().left;
          w.scrollTop = 180; w.scrollLeft = 180;
          return { rowHeight: row.getBoundingClientRect().height, before,
            left: row.firstElementChild.getBoundingClientRect().left,
            top: t.tHead.rows[0].cells[1].getBoundingClientRect().top,
            containerTop: w.getBoundingClientRect().top,
            font: getComputedStyle(row.querySelector('td')).fontFamily };
        });
        expect(geometry.rowHeight).toBeGreaterThanOrEqual(32);
        expect(geometry.rowHeight).toBeLessThanOrEqual(44); // two lines: name, then UNI
        expect(Math.abs(geometry.left - geometry.before)).toBeLessThan(1);
        expect(Math.abs(geometry.top - geometry.containerTop)).toBeLessThan(2);
        expect(geometry.font).toMatch(/Helvetica|Inter/);
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
    await expect(page.locator('#materials-root button')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({ path: `evidence/compact-ui/student-groups-${width}.png`, fullPage: true });
    await enter(page, 'grader', 'gradebook');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: `evidence/compact-ui/grader-gradebook-${width}.png`, fullPage: true });
  }
});
