import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
test.beforeEach(async ({page}) => {
  // Exercise only local demo data. Never contact the linked Supabase project.
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', { get: () => ({base:'',url:'',key:''}), set: () => {} }));
});
const fixture = fileURLToPath(new URL('../fixtures/canvas-roster.csv', import.meta.url));
const ready = async page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, path = '/materials/assignments/') => { await page.goto(`${path}?fakeauth=${role}`); await ready(page); };
async function switchRole(page, role) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.locator('.auth-controls [data-login]').click();
  await page.getByLabel('Preview role').selectOption(role);
  await page.getByRole('button', { name: 'Use demo role' }).click();
}
async function upload(page, title, shared = false) {
  await page.getByLabel('File title', { exact: true }).fill(title);
  await page.getByLabel('Lecture PDF (maximum 20 MB)').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF') });
  await page.locator('#file-form').getByLabel('Visible to auditors').setChecked(shared);
  await page.getByRole('button', { name: 'Upload PDF', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('PDF uploaded.');
}
test('signed-out schedule links open one modal and retain their intended milestone', async ({ page }) => {
  await page.goto('/schedule/week-2/'); await ready(page);
  await expect(page.getByRole('link', { name: 'Course Materials', exact: true })).toBeHidden();
  await page.getByRole('link', { name: 'Milestone #2: Proposal and Task Map' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Columbia Google' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('b8403-return'))).toBe('/materials/assignments/#milestone-2');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Lecture Notes: Week 2', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('b8403-return'))).toBe('/materials/lecture-notes/#week-2');
});
test('unlisted account is blocked on every materials page', async ({ page }) => {
  await enter(page, 'unlisted');
  await expect(page.locator('#materials-root')).toContainText('You are not on the class list');
  await expect(page.locator('#materials-root')).toContainText('oh@gsb.columbia.edu');
  await expect(page.locator('.assignment-section')).toHaveCount(0);
  for (const url of ['/materials/lecture-notes/', '/materials/attendance/', '/materials/groups/', '/materials/gradebook/', '/materials/roster/', '/materials/files/', '/materials/settings/']) { await page.goto(url); await ready(page); await expect(page.locator('#materials-root')).toContainText('You are not on the class list'); }
});
test('student sees materials, linked milestones, empty weeks, and no admin controls', async ({ page }) => {
  await enter(page, 'student'); await expect(page.locator('.assignment-section')).toHaveCount(6);
  await expect(page.locator('[data-role]')).toHaveText('Student');
  await expect(page.getByRole('link', { name: 'Course Materials', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
  await page.goto('/materials/files/'); await ready(page); await expect(page.locator('#materials-root')).toContainText('for instructors');
  await page.goto('/schedule/week-3/'); await ready(page);
  await expect(page.locator('[data-slides-status]')).toHaveText('Posted after class.');
  await page.getByRole('link', { name: 'Milestone #3: Working Setup' }).click(); await ready(page);
  await expect(page).toHaveURL(/assignments\/#milestone-3$/);
  await expect(page.locator('#outline')).toContainText('Demo milestone 3');
  await page.goto('/schedule/week-6/'); await ready(page);
  await page.getByRole('link', { name: 'Final Prototype', exact: true }).click(); await ready(page); await expect(page).toHaveURL(/#final-prototype$/);
  await page.goto('/schedule/week-2/'); await ready(page); await page.getByRole('link', { name: 'Lecture Notes: Week 2', exact: true }).click(); await ready(page);
  await expect(page).toHaveURL(/lecture-notes\/#week-2$/); await expect(page.locator('#week-2')).toContainText('Posted after class.');
});
test('instructor previews roster, replaces it, uploads a PDF, edits text, and manages access', async ({ page }) => {
  await enter(page, 'instructor', '/materials/roster/');
  await page.getByLabel('Canvas roster CSV').setInputFiles(fixture); await page.getByRole('button', { name: 'Preview roster' }).click();
  await expect(page.locator('#roster-form')).toContainText('2 valid students. 2 rows need attention.');
  await expect(page.locator('#roster-form')).toContainText('Missing or invalid UNI.');
  await expect(page.getByRole('button', { name: 'Replace roster', exact: true })).toBeDisabled();
  await page.locator('#roster-confirm').check(); await page.getByRole('button', { name: 'Replace roster', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Roster replaced: 2 students.');
  await page.goto('/materials/files/'); await ready(page); await upload(page, 'Shared local lecture', true);
  await page.goto('/materials/settings/'); await ready(page);
  const first = page.locator('#assignment-editor details').first(); await first.locator('summary').click();
  await first.getByLabel('Title', { exact: true }).fill('Edited demo assignment');
  await first.getByRole('button', { name: 'Save assignment' }).click(); await expect(first.getByRole('status')).toHaveText('Assignment saved.');
  await page.getByLabel('Columbia email', { exact: true }).fill('newta@gsb.columbia.edu'); await page.getByLabel('Access role').selectOption('instructor');
  await page.getByRole('button', { name: 'Save access', exact: true }).click(); await expect(page.locator('#access-lists')).toContainText('newta@gsb.columbia.edu');
  await page.goto('/materials/assignments/'); await ready(page); await expect(page.locator('.assignment-section').first()).toContainText('Edited demo assignment');
  await page.goto('/materials/lecture-notes/'); await ready(page); await expect(page.locator('#week-1')).toContainText('Shared local lecture');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Shared local lecture', exact: true }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('Shared local lecture.pdf');
});
test('auditor sees only flagged assignments and PDFs, including after a visibility change', async ({ page }) => {
  await enter(page, 'instructor', '/materials/files/'); await upload(page, 'Shared PDF', true); await upload(page, 'Private PDF', false);
  await switchRole(page, 'auditor'); await page.goto('/materials/assignments/'); await ready(page);
  await expect(page.locator('.assignment-section')).toHaveCount(1); await expect(page.locator('.assignment-section')).toContainText('Demo milestone 1');
  await page.goto('/materials/lecture-notes/'); await ready(page); await expect(page.getByRole('link', { name: 'Shared PDF', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Private PDF', exact: true })).toHaveCount(0);
  await switchRole(page, 'instructor'); await page.goto('/materials/files/'); await ready(page);
  await page.getByRole('button', { name: 'Hide Shared PDF from auditors', exact: true }).click(); await expect(page.locator('[data-admin-status]')).toHaveText('File visibility updated.');
  await switchRole(page, 'auditor'); await page.goto('/materials/lecture-notes/'); await ready(page); await expect(page.getByRole('link', { name: 'Shared PDF', exact: true })).toHaveCount(0);
});
test('CBS account cannot self-claim and can use an instructor-approved link', async ({page}) => {
  await enter(page,'gsb'); await page.getByLabel('Your Columbia UNI').fill('ab1234'); await page.getByRole('button',{name:'Check class list'}).click();
  await expect(page.locator('[data-login-message]')).toContainText('instructor to link');
  await page.getByRole('button',{name:'Close sign-in'}).click(); await switchRole(page,'instructor');
  await page.goto('/materials/settings/'); await ready(page);
  await page.getByLabel('CBS student email').fill('demo@gsb.columbia.edu'); await page.getByLabel('Roster UNI',{exact:true}).fill('ab1234'); await page.getByRole('button',{name:'Link student account',exact:true}).click();
  await expect(page.locator('#student-accounts')).toContainText('demo@gsb.columbia.edu');
  await switchRole(page,'gsb'); await page.goto('/materials/attendance/'); await ready(page); await expect(page.locator('[data-role]')).toHaveText('Student'); await expect(page.locator('#my-grades')).toContainText('8');
});
test('sign-out immediately removes rendered private material', async ({ page }) => {
  await enter(page, 'student'); await expect(page.locator('.assignment-section')).toHaveCount(6);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.locator('.assignment-section')).toHaveCount(0); await expect(page.locator('#materials-root')).toContainText('Sign in to see course materials.');
});
test('fakeauth query and stored demo session are inert on the live hostname', async ({ page }) => {
  await page.route('https://ai-finance-cbs.github.io/**', async route => {
    const u = new URL(route.request().url());
    const response = await page.request.get(`http://127.0.0.1:4173${u.pathname}`);
    await route.fulfill({ response });
  });
  await page.addInitScript(() => { sessionStorage.setItem('b8403-demo-enabled', '1'); sessionStorage.setItem('b8403-demo-user-v1', JSON.stringify({ email: 'oh@gsb.columbia.edu' })); });
  await page.goto('https://ai-finance-cbs.github.io/materials/files/?fakeauth=instructor'); await ready(page);
  await expect(page.locator('#materials-root')).toContainText('Sign in to see course materials.');
  await expect(page.locator('#roster-form')).toHaveCount(0);
  await page.locator('.auth-controls [data-login]').click(); await expect(page.locator('[data-demo-controls]')).toBeHidden();
});
test('desktop and phone pages fit, keep public navigation, and render without errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  mkdirSync('evidence/class-tools', { recursive: true });
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const path of ['/', '/library/', '/schedule/week-1/', '/materials/assignments/', '/materials/lecture-notes/', '/materials/attendance/', '/materials/groups/', '/materials/gradebook/', '/materials/roster/', '/materials/files/', '/materials/settings/']) {
      await enter(page, 'instructor', path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} at ${width}`).toBe(true);
      await expect(page.locator('h1')).toHaveCount(1);
      const bounds=await page.evaluate(()=>({heading:document.querySelector('h1').getBoundingClientRect().top,header:document.querySelector('.topbar').getBoundingClientRect().bottom}));expect(bounds.heading).toBeGreaterThan(bounds.header);
    }
    await page.screenshot({ path: `evidence/class-tools/settings-${width}.png`, fullPage: true });
    if (width < 820) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click(); await expect(page.getByRole('link', { name: 'Course Materials', exact: true })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(page.getByRole('link', { name: 'Course Materials', exact: true })).toBeHidden();
    }
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.locator('.auth-controls [data-login]').click();
  await page.screenshot({ path: 'evidence/class-tools/login-phone.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('invalid roster leaves the class list intact and instructor can delete uploaded PDFs', async ({ page }) => {
  await enter(page, 'instructor', '/materials/roster/');
  await page.getByLabel('Canvas roster CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('Student,SIS User ID\nMissing UNI,12345') });
  await page.getByRole('button', { name: 'Preview roster' }).click();
  await expect(page.locator('#roster-form')).toContainText('No valid UNIs found.');
  await expect(page.getByRole('button', { name: 'Replace roster', exact: true })).toHaveCount(0);
  await expect(page.locator('#class-roster')).toContainText('3 students on the class list.');
  await page.goto('/materials/files/'); await ready(page); await upload(page, 'Delete this PDF');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Delete this PDF', exact: true }).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('PDF deleted.');
  await page.goto('/materials/lecture-notes/'); await ready(page);
  await expect(page.getByRole('link', { name: 'Delete this PDF', exact: true })).toHaveCount(0);
});
test('login from a milestone returns to that exact assignment after demo sign-in', async ({ page }) => {
  await enter(page, 'student', '/schedule/week-4/');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('link', { name: 'Milestone #4: Personal Benchmark' }).click();
  await page.getByLabel('Preview role').selectOption('student');
  await page.getByRole('button', { name: 'Use demo role' }).click();
  await ready(page); await expect(page).toHaveURL(/assignments\/#milestone-4$/);
  await expect(page.locator('#milestone-4')).toBeVisible();
});
