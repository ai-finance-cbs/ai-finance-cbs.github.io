import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const pages = ['/', '/syllabus/', ...Array.from({length:6},(_,i)=>`/syllabus/week-${i+1}/`), '/library/', ...['prelude','economics-of-ai','ai-infrastructure','processing-information','predicting-outcomes','persuading-stakeholders','future-of-finance','coda'].map(slug=>`/library/${slug}/`), '/staff/', '/materials/',
  ...['prelude', 'week-1', 'week-2', 'week-3', 'week-4', 'week-5', 'week-6', 'coda', 'grades', 'attendance', 'groups', 'gradebook', 'roster', 'files', 'settings'].map(name => `/materials/${name}/`)];
const roles = ['signed-out', 'student', 'grader', 'instructor', 'preview', 'auditor', 'unlisted'];
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');

test.beforeEach(async ({ page }) => {
  // Local demo sessions only. Never connect these tests to hosted course records.
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({ base: '', url: '', key: '' }), set: () => {},
  }));
});

for (const width of [1440, 1180, 1024, 390, 320]) {
  test(`top bar keeps fixed title, menu, and submenu positions across pages and roles at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 950 });
    mkdirSync('evidence/phase-b/topbar', { recursive: true });
    const measurements = [];
    let baseline, submenuBottom;
    let desktopReference;
    if (width >= 820) {
      // Compare every desktop width to the same rendered 1440px header, not just to itself.
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.goto('/'); await ready(page);
      await page.evaluate(() => document.fonts.ready);
      desktopReference = await page.evaluate(() => ({
        height: document.querySelector('.topbar').getBoundingClientRect().height,
        titleTop: document.querySelector('.brand-title').getBoundingClientRect().top,
        navTop: document.querySelector('.topnav').getBoundingClientRect().top,
        submenuTop: document.querySelector('.topbar-main > .subnav-top').getBoundingClientRect().top,
      }));
      await page.setViewportSize({ width, height: 950 });
    }
    for (const role of roles) {
      await page.goto('/'); await ready(page);
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(role === 'signed-out' ? '/' : `/?fakeauth=${role === 'preview' ? 'instructor' : role}`);
      await ready(page);
      if (role === 'preview') {
        await page.locator('[data-view-select]').selectOption('test1');
        await expect(page.locator('[data-preview-banner]')).toBeVisible();
      }
      for (const path of pages) {
        await page.goto(path); await ready(page);
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
          const rect = node => node.getBoundingClientRect().toJSON();
          const bar = document.querySelector('.topbar');
          const titleRow = innerWidth < 820 ? bar : document.querySelector('.brand-row');
          const title = document.querySelector('.brand-title');
          const account = document.querySelector('.auth-controls');
          const nav = document.querySelector('.topnav');
          const sub = document.querySelector('.topbar-main > .subnav-top');
          const controls = [...document.querySelectorAll('.auth-controls > *, [data-demo-tag]')].filter(n => !n.hidden);
          return {
            height: rect(bar).height,
            titleTop: rect(title).top,
            titleRowTop: rect(titleRow).top,
            titleRowHeight: rect(titleRow).height,
            menuTop: rect(document.querySelector('.menu-row')).top,
            navTop: rect(nav).top,
            firstLinkTop: rect(nav.querySelector('a')).top,
            submenuTop: rect(sub).top,
            submenuHeight: rect(sub).height,
            submenuLinks: [...sub.querySelectorAll('a')].map(rect),
            accountTop: rect(account).top,
            accountHeight: rect(account).height,
            titleFont: getComputedStyle(document.querySelector('.brand-title')).fontFamily,
            titleRow: rect(titleRow),
            controls: controls.map(n => ({ label: n.textContent.trim(), ...rect(n) })),
            links: [...nav.querySelectorAll('li:not([hidden]) a')].filter(n => n.getClientRects().length).map(rect),
            titleFits: title.scrollWidth <= title.clientWidth + 1,
            brandRight: rect(document.querySelector('.brand-heading')).right,
            brandBottom: rect(document.querySelector('.brand-heading')).bottom,
            accountLeft: rect(account).left,
            fits: document.documentElement.scrollWidth <= innerWidth,
            headingTop: document.querySelector('h1').getBoundingClientRect().top,
          };
        });
        const { controls, links, submenuLinks, titleRow, fits, headingTop, titleFont, titleFits, brandRight, brandBottom, accountLeft, ...positions } = geometry;
        baseline ||= positions;
        expect(positions, `${role} ${path} at ${width}`).toEqual(baseline);
        if (width >= 820) {
          expect(geometry.height).toBe(148);
          expect(geometry.titleTop).toBe(15);
          expect(geometry.navTop).toBe(54);
          expect(geometry.submenuTop).toBe(91);
        }
        if (desktopReference) expect({ height: geometry.height, titleTop: geometry.titleTop,
          navTop: geometry.navTop, submenuTop: geometry.submenuTop }).toEqual(desktopReference);
        expect(fits, `${role} ${path} must not overflow`).toBe(true);
        expect(headingTop).toBeGreaterThan(geometry.height);
        expect(titleFont).toContain('Source Serif');
        expect(titleFits).toBe(true);
        if (width >= 820) expect(brandRight).toBeLessThan(accountLeft);
        else expect(brandBottom).toBeLessThan(geometry.accountTop);
        for (const control of controls) {
          expect(control.top, `${control.label} stays in the title row`).toBeGreaterThanOrEqual(titleRow.top);
          expect(control.bottom).toBeLessThanOrEqual(titleRow.bottom);
          expect(control.left).toBeGreaterThanOrEqual(titleRow.left);
          expect(control.right).toBeLessThanOrEqual(titleRow.right + 1);
        }
        for (const link of links) {
          expect(link.top).toBeGreaterThanOrEqual(geometry.menuTop);
          expect(link.bottom).toBeLessThanOrEqual(geometry.submenuTop);
        }
        if (width >= 820) for (const link of submenuLinks) {
          submenuBottom ??= link.bottom;
          expect(link.bottom).toBe(submenuBottom);
        }
        measurements.push({ role, path, ...positions });
        if ((role === 'signed-out' && path === '/syllabus/') ||
            (role === 'student' && path === '/materials/week-3/') ||
            (role === 'instructor' && path === '/materials/gradebook/') ||
            (role === 'preview' && path === '/materials/attendance/')) {
          await page.locator('.topbar').screenshot({ path: `evidence/phase-b/topbar/${role}-${width}.png` });
        }
      }
    }
    writeFileSync(`evidence/phase-b/topbar/geometry-${width}.json`, JSON.stringify(measurements, null, 2));
  });
}
