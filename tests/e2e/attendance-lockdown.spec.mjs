import { test, expect } from '@playwright/test';
const editAttendance = async page => { await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByRole('button', { name: 'Yes, edit attendance', exact: true }).click(); };
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role) => { await page.goto(`/materials/attendance/?fakeauth=${role}`); await ready(page); };
const cell = (page, week = 1) => page.getByLabel(`ab1234 Week ${week} attendance`, { exact: true });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', { get: () => ({ base: '', url: '', key: '' }), set: () => {} }));
});

for (const width of [1440, 390]) test(`instructor excuses and removes inline at ${width}px; reason is visible in the profile`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 }); await enter(page, 'instructor');
  await expect(page.locator('.attendance-grid select, #attendance-import')).toHaveCount(0);
  await expect(page.locator('.attendance-legend')).toHaveText('Attendance comes from quiz scores. Only the instructor can excuse an absence.');
  await expect(cell(page).getByRole('button', { name: 'Excuse', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cell(page).getByRole('button', { name: 'Excuse', exact: true })).toBeHidden();
  await editAttendance(page);
  await cell(page).getByRole('button', { name: 'Excuse', exact: true }).click();
  const reason = cell(page).getByRole('textbox');
  await expect(reason).toBeFocused(); await expect(reason).toHaveAttribute('maxlength', '300');
  await cell(page).getByRole('button', { name: 'Save', exact: true }).click();
  expect(await reason.evaluate(n => n.validity.valueMissing)).toBe(true);
  await reason.fill('   '); await cell(page).getByRole('button', { name: 'Save', exact: true }).click();
  expect(await reason.evaluate(n => n.validity.customError)).toBe(true);
  await reason.fill('Cancelled reason'); await cell(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cell(page).getByRole('textbox')).toHaveCount(0);
  await cell(page).getByRole('button', { name: 'Excuse', exact: true }).click();
  await reason.fill('Approved absence'); await cell(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(cell(page).locator('.attendance-status')).toHaveText('Excused');
  await expect(cell(page).locator('.attendance-status')).toHaveAttribute('title', 'Approved absence');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 1$/);
  await page.locator('[data-student-profile="ab1234"]').click();
  await expect(page.locator('.profile-excuse-reason')).toHaveText('Week 1 excused: Approved absence');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close student card', exact: true }).click();
  await page.screenshot({ path: `evidence/attendance-lockdown/instructor-${width}.png`, fullPage: true });
  await cell(page).getByRole('button', { name: 'Remove excuse', exact: true }).click();
  await expect(cell(page).locator('.attendance-status')).toHaveText('');
  await expect(page.getByLabel('Week 1 totals', { exact: true })).toHaveText(/^Present 0Absent (\d+|—)Excused 0$/);
  await expect(cell(page).getByRole('button', { name: 'Excuse', exact: true })).toBeVisible();
});

test('grader has no attendance actions or CSV import; quiz scores replace excuses and clear presence', async ({ page }) => {
  await enter(page, 'instructor');
  await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    await b.saveAttendance(1, [{ uni: 'ab1234', status: 'excused', excuse_reason: 'Approved absence' }]);
  });
  await enter(page, 'grader');
  await expect(page.locator('.attendance-grid select, .attendance-action, #attendance-import')).toHaveCount(0);
  await expect(page.getByText('Import attendance CSV', { exact: true })).toHaveCount(0);
  await expect(cell(page).locator('.attendance-status')).toHaveText('Excused');
  await page.goto('/materials/gradebook/'); await ready(page);
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/'); await ready(page);
  await expect(cell(page).locator('.attendance-status')).toHaveText('✓');
  await expect(cell(page).locator('.quiz-marker')).toContainText('Q1');
  await expect(cell(page).locator('.attendance-status')).not.toHaveAttribute('title');
  await page.goto('/materials/gradebook/'); await ready(page);
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/'); await ready(page);
  await expect(cell(page).locator('.attendance-status')).toHaveText('');
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
