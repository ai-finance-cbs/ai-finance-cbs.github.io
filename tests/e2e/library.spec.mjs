import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  // Library checks remain local and never use hosted course records.
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({ base: '', url: '', key: '' }), set: () => {},
  }));
});

for (const width of [1440, 390]) {
  test(`migrated Library entries render and filter correctly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const pages = [
      ['economics-of-ai', 'Our AI Midwife', 'Drew Housman (2026)'],
      ['coda', 'AI in Finance: Syllabus and Lecture Notes', 'Arpit Gupta (2026)'],
    ];
    for (const [slug, title, author] of pages) {
      await page.goto(`/library/${slug}/`);
      const row = page.locator('.material').filter({ has: page.getByRole('link', { name: title, exact: true }) });
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('data-level', 'optional');
      await expect(row.locator('.material-source')).toHaveText(author);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Arpitrage', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Generative AI for Finance (MGMT 675)', exact: true })).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Show only required' });
    await toggle.click();
    await expect(page.locator('.material[data-level="optional"]:visible')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all materials' }).click();
    await expect(page.getByRole('link', { name: 'Theorist Toolbox', exact: true })).toBeVisible();

    // Verify a populated week page, including its long author rows, in the browser.
    await page.goto('/library/economics-of-ai/');
    await expect(page.getByRole('link', { name: 'Our AI Midwife', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    mkdirSync('evidence/library-migrate/amendment-2', { recursive: true });
    await page.screenshot({ path: `evidence/library-migrate/amendment-2/week-1-${width}.png`, fullPage: true });
  });

  test(`hidden Academic Research section stays off the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/library/economics-of-ai/');
    const main = page.locator('.content');
    await expect(main.locator('h2')).toHaveText(['Economic Frameworks for AI', 'Bulls vs. Skeptics', 'Nature of Financial Work']);
    await expect(page.getByRole('region', { name: 'Academic Research', exact: true })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Expertise', exact: true })).toHaveCount(0);
    if (width >= 820) await expect(page.locator('#outline').getByRole('link', { name: 'Academic Research', exact: true })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'A.I. and Our Economic Future', exact: true })).toBeVisible();
  });
}

test('classics retain the BCE display year and both beginner videos show their full duration', async ({ page }) => {
  await page.goto('/library/prelude/');
  const classics = page.locator('.topic-block').filter({ has: page.getByRole('heading', { name: 'Prescient Reads', exact: true }) });
  const firstOptional = classics.locator('.material[data-level="optional"]').first();
  await expect(firstOptional.getByRole('link')).toHaveText('Phaedrus');
  await expect(firstOptional.locator('.material-source')).toHaveText('Plato (c. 370 BCE)');
  await expect(classics.getByRole('link', { name: 'On the Foolishness of “Natural Language Programming”', exact: true }))
    .toHaveAttribute('href', 'https://www.cs.utexas.edu/~EWD/transcriptions/EWD06xx/EWD667.html');
  for (const [title, duration] of [['Getting Started with Claude Code', '3 hr 4 min'], ['Getting Started with Codex', '4 hr 3 min']]) {
    const row = page.locator('.material').filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(row.locator('.material-length')).toContainText(duration);
    await expect(row.locator('.material-source')).toHaveText('Aniket Panjwani (2026)');
  }
});
