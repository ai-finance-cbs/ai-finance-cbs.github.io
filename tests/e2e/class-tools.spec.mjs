import { test, expect } from '@playwright/test';
const ready = async (page) =>
  expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, path) => {
  await page.goto(`/materials/${path}/?fakeauth=${role}`);
  await ready(page);
};
test.beforeEach(async ({ page }) => {
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
  await enter(page, 'grader', 'gradebook');
  await expect(page.locator('[data-role]')).toHaveText('Grader');
  await expect(page.locator('.topnav a:visible')).toHaveText([
    'Home',
    'Syllabus',
    'Library',
    'Staff',
    'Nota Bene',
    'Course Materials',
    'Assignments',
    'Gradebook',
    'Attendance',
  ]);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('[data-view-picker]')).toBeHidden();
  for (const path of ['roster', 'files', 'settings', 'groups', 'grades', 'submit']) {
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
test('grader enters quiz scores by column and CSV; attendance shows quiz source and manual overrides', async ({
  page,
}) => {
  await enter(page, 'grader', 'gradebook');
  await page.getByLabel('Gradebook item').selectOption('7');
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('0');
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).press('Enter');
  await expect(page.getByLabel('cd5678 In-class quiz 1', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.getByLabel('Gradebook item').selectOption('8');
  await page.locator('#grade-import > summary').click();
  await page.getByLabel('Grade CSV', { exact: true }).setInputFiles({
    name: 'quiz.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('uni,score\nab1234,2\ncd5678,0'),
  });
  await page.getByRole('button', { name: 'Preview grade import' }).click();
  await expect(page.locator('#materials-root')).toContainText('2 scores ready to import');
  await page.getByRole('button', { name: 'Import scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores imported');
  await page.goto('/materials/attendance/');
  await ready(page);
  await expect(page.getByLabel('ab1234 Week 1 attendance')).toHaveValue('present');
  await expect(page.getByLabel('cd5678 Week 2 attendance')).toHaveValue('present');
  await expect(page.locator('#materials-root')).toContainText('from Quiz 2');
  await page.getByLabel('ab1234 Week 2 attendance').selectOption('excused');
  await expect(page.locator('#materials-root')).toContainText('Manual override; Quiz 2 recorded');
  await page.goto('/materials/gradebook/');
  await ready(page);
  await page.getByLabel('ab1234 In-class quiz 2', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/');
  await ready(page);
  await expect(page.getByLabel('ab1234 Week 2 attendance')).toHaveValue('excused');
});
test('student sees own released scores and teammate identities only after joining', async ({
  page,
}) => {
  await enter(page, 'student', 'attendance');
  await expect(page.locator('#my-grades')).toHaveCount(0);
  await page.goto('/materials/grades/'); await ready(page);
  await expect(page.locator('[data-grade-code=M1] .grade-score')).toHaveText('8 / 10');
  await expect(page.locator('[data-grade-code=M2] .grade-score')).toHaveCount(0);
  await expect(page.locator('#materials-root')).not.toContainText('Second Student');
  await page.goto('/materials/groups/');
  await ready(page);
  await expect(page.locator('#materials-root')).not.toContainText('Second Student');
  await expect(page.locator('#materials-root')).not.toContainText('cd5678');
  await page.getByRole('button', { name: 'Join Group 1 in Week 2 lab', exact: true }).click();
  await expect(page.locator('#materials-root')).toContainText('Second Student');
  await expect(page.locator('#materials-root')).toContainText('cd5678@columbia.edu');
  const members = await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    return (await createDemo().classData()).members;
  });
  expect(members.find((m) => m.name === 'Second Student').uni).toBeNull();
  await page.getByRole('button', { name: 'Switch to Group 2 in Week 2 lab', exact: true }).click();
  await expect(page.locator('#materials-root')).not.toContainText('Second Student');
  await page.getByRole('button', { name: 'Leave Group 2 in Week 2 lab', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Join Group 2 in Week 2 lab', exact: true }),
  ).toBeVisible();
});
test('instructor can import attendance, create and lock groups, and release scores', async ({
  page,
}) => {
  await enter(page, 'instructor', 'attendance');
  await page.getByLabel('Week 1 date', { exact: true }).fill('2027-01-25');
  await page.locator('#attendance-import > summary').click();
  await page.getByLabel('Present UNI CSV').setInputFiles({
    name: 'present.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('UNI\nab1234\ncd5678'),
  });
  await page.getByRole('button', { name: 'Import present UNIs' }).click();
  await expect(page.getByLabel('ab1234 Week 1 attendance')).toHaveValue('present');
  await page.goto('/materials/groups/');
  await ready(page);
  await page.getByLabel('Group set title', { exact: true }).fill('Final project');
  await page.getByLabel('Number of groups', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Create group set', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Final project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock Final project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Final project', exact: true })).toBeVisible();
  await page.goto('/materials/gradebook/');
  await ready(page);
  await page.getByRole('button', { name: 'Q1 visibility: Hidden', exact: true }).click();
  await page.getByRole('group', { name: 'Release confirmation' }).getByRole('button', { name: 'Show scores', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Q1 visibility: Visible', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export gradebook CSV', exact: true }).click();
  expect((await dl).suggestedFilename()).toBe('gradebook.csv');
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
    'Staff',
    'Nota Bene',
    'Course Materials',
    'Assignments',
    'Attendance',
    'Grades',
    'Groups',
    'Submit',
  ]);
  await page.goto('/materials/groups/');
  await ready(page);
  await expect(page.locator('#materials-root button')).toHaveCount(0);
  const errors = await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    const b = createDemo(),
      results = [];
    for (const task of [
      () => b.saveGrades([{ uni: 'ab1234', item_id: 1, score: 10 }]),
      () => b.saveAttendance(1, [{ uni: 'ab1234', status: 'present' }]),
      () => b.chooseGroup('demo-set', 'demo-group-1'),
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
  expect(errors).toHaveLength(4);
  expect(errors.every((e) => e !== 'ALLOWED')).toBe(true);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'evidence/class-tools/preview-phone.png', fullPage: true });
  await page.locator('[data-preview-exit]').click();
  await expect(page.locator('[data-role]')).toHaveText('Instructor');
  await expect(page.getByRole('button', { name: 'Create group set', exact: true })).toBeVisible();
});
test('auditor gets shared Assignments but cannot open student or staff tools', async ({ page }) => {
  await enter(page, 'auditor', 'week-1');
  await expect(page.locator('.topnav a:visible')).toHaveText([
    'Home',
    'Syllabus',
    'Library',
    'Staff',
    'Nota Bene',
    'Course Materials',
    'Assignments',
  ]);
  for (const path of ['attendance', 'grades', 'groups', 'gradebook', 'roster', 'files', 'settings', 'submit']) {
    await page.goto(`/materials/${path}/`);
    await ready(page);
    await expect(page.locator('#materials-root input')).toHaveCount(0);
    await expect(page.locator('#materials-root')).toContainText(/instructors|does not have access/);
  }
});

test('students and preview see plain attendance until the matching quiz is released', async ({
  page,
}) => {
  await enter(page, 'grader', 'gradebook');
  await page.getByLabel('ab1234 In-class quiz 1', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Scores saved');
  await page.goto('/materials/attendance/');
  await ready(page);
  await expect(page.locator('#materials-root')).toContainText('from Quiz 1');
  await enter(page, 'student', 'attendance');
  const firstWeek = page.locator('.class-grid tbody tr').first();
  await expect(firstWeek).toContainText('present');
  await expect(firstWeek.locator('td').last()).toHaveText('');
  await expect(page.locator('#my-grades')).toHaveCount(0);
  const hidden = await page.evaluate(async () => {
    const { createDemo } = await import('/assets/materials/demo.js');
    return (await createDemo().classData()).attendance;
  });
  expect(hidden).toEqual([
    { uni: 'ab1234', week: 1, status: 'present', source_quiz: null, manual_override: null },
  ]);
  await enter(page, 'instructor', 'roster');
  await page.getByRole('button', { name: 'View as Demo Student', exact: true }).click();
  await expect(page.locator('[data-preview-banner]')).toBeVisible();
  await expect(page.locator('.class-grid tbody tr').first().locator('td').last()).toHaveText('');
  await page.locator('[data-preview-exit]').click();
  await page.goto('/materials/gradebook/');
  await ready(page);
  await page.getByRole('button', { name: 'Q1 visibility: Hidden', exact: true }).click();
  await page.getByRole('group', { name: 'Release confirmation' }).getByRole('button', { name: 'Show scores', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toContainText('Release status saved');
  await enter(page, 'student', 'attendance');
  await expect(page.locator('.class-grid tbody tr').first()).toContainText('from Quiz 1');
  await page.goto('/materials/grades/'); await ready(page);
  await expect(page.locator('[data-grade-code=Q1] .grade-score')).toHaveText('0 / 3');
});
