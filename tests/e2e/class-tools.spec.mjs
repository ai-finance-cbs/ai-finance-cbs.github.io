import {installArchiveFixture} from './archive-fixture.mjs';
import { test, expect } from '@playwright/test';
const openCell = async (page, cell) => { await cell.locator('.attendance-mark').click(); return page.getByRole('dialog'); };
const ready = async (page) =>
  expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, path) => {
  await page.goto(`/materials/${path}/?fakeauth=${role}`);
  await ready(page);
};
test.beforeEach(async ({ page }) => {
  await installArchiveFixture(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, 'COURSE_MATERIALS', {
      get: () => ({ base: '', url: '', key: '' }),
      set: () => {},
    }),
  );
});
test('grader menu and direct page gates expose only materials, grades, and attendance', async ({
  page,
}) => {
  // Gradebook is standalone (no top bar), so read the grader menu from Attendance.
  await enter(page, 'grader', 'attendance');
  await expect(page.locator('[data-role]')).toHaveText('Grader');
  await expect(page.locator('.topnav a:visible')).toHaveText([
    'Home',
    'Syllabus',
    'Library',
    'Nota Bene',
    'Course Materials',
    'Assignments',
    'Groups',
  ]);
  await expect(page.locator('.staff-menu li:not([hidden]) a')).toHaveText(['Gradebook', 'Attendance']);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('[data-view-picker]')).toBeHidden();
  for (const path of ['roster', 'files', 'settings', 'grades']) {
    await page.goto(`/materials/${path}/`);
    await ready(page);
    await expect(page.locator('#materials-root')).toContainText(/instructors|does not have access/);
    await expect(page.locator('#materials-root input')).toHaveCount(0);
  }
  await page.goto('/materials/attendance/');
  await ready(page);
  await expect(page.getByLabel('ab1234 Week 1 attendance')).toBeVisible();
  await expect(page.locator('input[type=date]')).toHaveCount(0);
});

test('student sees posted Canvas grades and teammate names without joining controls',async({page})=>{
  await enter(page,'student','grades');await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('8 / 10');
  await expect(page.locator('[data-grade-code=M2] .grade-score')).toHaveText('Not posted');
  await page.goto('/materials/groups/');await ready(page);await expect(page.locator('#materials-root')).toContainText('Second Student');
  await expect(page.locator('#materials-root')).not.toContainText('cd5678');await expect(page.locator('#materials-root button')).toHaveCount(0);
});
test('instructor can excuse attendance, read Canvas groups, without local release controls', async ({
  page,
}) => {
  await enter(page, 'instructor', 'attendance');
  const cell = page.getByLabel('ab1234 Week 1 attendance', { exact: true });
  const dialog = await openCell(page, cell);
  await dialog.getByRole('textbox').fill('Approved absence');
  await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  await expect(cell.locator('.attendance-mark')).toHaveText('EX');
  await page.goto('/materials/groups/');
  await ready(page);
  await expect(page.locator('#materials-root button,#materials-root input,#materials-root select')).toHaveCount(0);
  await page.goto('/materials/gradebook/');
  await ready(page);
  await expect(page.locator('.canvas-grid')).toBeVisible();
  await expect(page.locator('button.grade-visibility')).toHaveCount(0);
});
test('view-as matches student content and denies writes even when calling the backend directly', async ({
  page,
}) => {
  await enter(page, 'instructor', 'roster');
  await page.getByRole('button', { name: 'View as Demo Student', exact: true }).click();
  await ready(page);
  await expect(page).toHaveURL(/attendance\/$/);
  await expect(page.locator('[data-preview-banner]')).toContainText('Viewing as Demo Student');
  await expect(page.locator('#my-grades')).toHaveCount(0);
  await page.goto('/materials/grades/'); await ready(page);
  await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('8 / 10');
  await expect(page.locator('.topnav a:visible')).toHaveText([
    'Home',
    'Syllabus',
    'Library',
    'Nota Bene',
    'Course Materials',
    'Assignments',
    'Attendance',
    'Grades',
    'Groups',
  ]);
  await page.goto('/materials/groups/');
  await ready(page);
  await expect(page.locator('#materials-root button')).toHaveCount(0);
  const errors = await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo(),
      results = [];
    for(const name of ['saveGrades','chooseGroup'])results.push(name in b ? 'Retired wrapper remains' : 'Retired wrapper removed');
    for (const task of [
      () => b.saveAttendance(1, [{ uni: 'ab1234', status: 'present' }]),
      () => b.saveAllowlist({ email: 'x@columbia.edu', role: 'instructor' }),
    ])
      try {
        await task();
        results.push('ALLOWED');
      } catch (e) {
        results.push(e.message);
      }
    return results;
  });
  expect(errors).toHaveLength(4);expect(errors.slice(0,2)).toEqual(['Retired wrapper removed','Retired wrapper removed']);
  expect(errors.every((e) => e !== 'ALLOWED')).toBe(true);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'evidence/class-tools/preview-phone.png', fullPage: true });
  await page.locator('[data-preview-exit]').click();
  await expect(page.locator('[data-role]')).toHaveText('Instructor');
  await expect(page.getByRole('button', { name: 'Create group set', exact: true })).toHaveCount(0);
});
test('auditor gets shared Assignments but cannot open student or staff tools', async ({ page }) => {
  await enter(page, 'auditor', 'week-1');
  await expect(page.locator('.topnav a:visible')).toHaveText([
    'Home',
    'Syllabus',
    'Library',
    'Nota Bene',
    'Course Materials',
    'Assignments',
  ]);
  for (const path of ['attendance', 'grades', 'groups', 'gradebook', 'roster', 'files', 'settings']) {
    await page.goto(`/materials/${path}/`);
    await ready(page);
    await expect(page.locator('#materials-root input')).toHaveCount(0);
    await expect(page.locator('#materials-root')).toContainText(/instructors|does not have access/);
  }
});
