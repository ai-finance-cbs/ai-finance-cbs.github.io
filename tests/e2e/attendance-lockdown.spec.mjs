import { test, expect } from '@playwright/test';
const openCell = async (page, cell) => { await cell.locator('.attendance-mark').click(); return page.getByRole('dialog'); };
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role) => { await page.goto(`/materials/attendance/?fakeauth=${role}`); await ready(page); };
const cell = (page, week = 1) => page.getByLabel(`ab1234 Week ${week} attendance`, { exact: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', { get: () => ({ base: '', url: '', key: '' }), set: () => {} }));
});

for (const width of [1440, 390]) test(`instructor excuses and removes inline at ${width}px; reason is visible in the profile`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 }); await enter(page, 'instructor');
  await expect(page.locator('.attendance-grid select, #attendance-import')).toHaveCount(0);
  await expect(page.locator('.attendance-legend')).toHaveText('Attendance comes from quiz scores. Click a cell for details; only the instructor can excuse an absence.');
  await expect(page.locator('.attendance-action, .attendance-edit-toggle')).toHaveCount(0);
  let dialog = await openCell(page, cell(page));
  await expect(dialog).toContainText('Do you really want to change the attendance?');
  const reason = dialog.getByRole('textbox');
  await expect(reason).toBeFocused(); await expect(reason).toHaveAttribute('maxlength', '300');
  await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  expect(await reason.evaluate(n => n.validity.valueMissing)).toBe(true);
  await reason.fill('   '); await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  expect(await reason.evaluate(n => n.validity.customError)).toBe(true);
  await reason.fill('Cancelled reason'); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(cell(page).locator('.attendance-mark')).toHaveText('–');
  dialog = await openCell(page, cell(page));
  await dialog.getByRole('textbox').fill('Approved absence'); await dialog.getByRole('button', { name: 'Excuse absence', exact: true }).click();
  await expect(cell(page).locator('.attendance-mark')).toHaveText('EX');
  await expect(cell(page).locator('.attendance-mark')).toHaveAttribute('title', 'Approved absence');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 1$/);
  await page.locator('[data-student-profile="ab1234"]').click();
  await expect(page.locator('.profile-excuse-reason')).toHaveText('Week 1 excused: Approved absence');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close student card', exact: true }).click();
  await page.screenshot({ path: `evidence/attendance-lockdown/instructor-${width}.png`, fullPage: true });
  dialog = await openCell(page, cell(page));
  await expect(dialog).toContainText('Do you really want to change the attendance?');
  await dialog.getByRole('button', { name: 'Remove excuse', exact: true }).click();
  await expect(cell(page).locator('.attendance-mark')).toHaveText('–');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 0$/);
});

test('grader has no attendance actions or CSV import; quiz scores replace excuses and clear presence', async ({ page }) => {
  await enter(page, 'instructor');
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    await b.saveAttendance(1, [{ uni: 'ab1234', status: 'excused', excuse_reason: 'Approved absence' }]);
  });
  await enter(page, 'grader');
  await expect(page.locator('.attendance-grid select, .attendance-action, .attendance-edit-toggle, #attendance-import')).toHaveCount(0);
  await expect(page.getByText('Import attendance CSV', { exact: true })).toHaveCount(0);
  await expect(cell(page).locator('.attendance-mark')).toHaveText('EX');
  const info = await openCell(page, cell(page));
  await expect(info.getByRole('button')).toHaveText(['Close']); await info.getByRole('button', { name: 'Close' }).click();
  await page.goto('/materials/gradebook/'); await ready(page);
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/'); await ready(page);
  await expect(cell(page).locator('.attendance-mark')).toHaveText('✓');
  await expect(cell(page).locator('.quiz-marker')).toContainText('Q1');
  await expect(cell(page).locator('.attendance-mark')).not.toHaveAttribute('title');
  await page.goto('/materials/gradebook/'); await ready(page);
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/'); await ready(page);
  await expect(cell(page).locator('.attendance-mark')).toHaveText('–');
  await expect(cell(page).locator('.quiz-marker')).toHaveCount(0);
});

test('students and preview see Present, Absent, Excused without reasons or edit controls', async ({ page }) => {
  await enter(page, 'instructor');
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    await b.saveAttendance(1, [{ uni: 'ab1234', status: 'excused', excuse_reason: 'Staff-only reason' }]);
    await b.saveGrades([{ uni: 'ab1234', item_id: 8, score: 0 }]);
  });
  await enter(page, 'student');
  const states = page.locator('.student-attendance-grid tbody tr td:nth-child(3)');
  await expect(states).toHaveText(['Excused', 'Present', 'Absent', 'Absent', 'Absent', 'Absent']);
  await expect(page.locator('#materials-root')).not.toContainText('Staff-only reason');
  await expect(page.locator('.attendance-action, .attendance-excuse-form')).toHaveCount(0);
  await enter(page, 'instructor'); await page.locator('[data-view-select]').selectOption('ab1234');
  await expect(page.locator('[data-preview-banner]')).toBeVisible();
  await expect(states).toHaveText(['Excused', 'Present', 'Absent', 'Absent', 'Absent', 'Absent']);
  await expect(page.locator('.attendance-action')).toHaveCount(0);
});
