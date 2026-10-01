import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready', 'true');
const enter = async (page, role, section = 'upcoming') => {
  await page.goto(`/materials/${section}/?fakeauth=${role}`); await ready(page);
};
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window, 'COURSE_MATERIALS', {
    get: () => ({base:'',url:'',key:''}), set: () => {},
  }));
  await page.clock.setFixedTime(new Date('2027-01-17T15:00:00Z'));
});
async function seed(page) {
  await enter(page,'instructor');
  await page.evaluate(async () => {
    const backend = (await import('/assets/materials/demo.js')).createDemo();
    await backend.setSessionDate(1,'2027-01-10');
    const key = 'b8403-demo-state-v3', d = JSON.parse(sessionStorage.getItem(key));
    d.sessions[1].date = '2027-01-17';
    d.sessions[2].date = '2027-01-24';
    d.files = [{id:'prior',week:1,title:'Previous class PDF',auditor_visible:true},
      {id:'hidden',week:2,title:'Enrolled students PDF',auditor_visible:false}];
    d.announcements = [{id:'older',title:'Earlier notice',body:'Read before class.',created_at:'2027-01-10T15:00:00Z'},
      {id:'newer',title:'Latest notice',body:'Bring a pencil.',created_at:'2027-01-16T15:00:00Z'}];
    d.sets[0].deadline='2027-01-20T18:00:00Z';
    sessionStorage.setItem(key,JSON.stringify(d));
  });
}

test('Upcoming is the default materials tab and chooses unset, today, future, and finished sessions', async ({page}) => {
  await enter(page,'student');
  await expect(page.locator('[data-next-class]')).toHaveText('Week 1 · AI Economics');
  await expect(page.getByRole('link',{name:'Course Materials',exact:true})).toHaveAttribute('href','/materials/upcoming/');
  await expect(page.locator('.subnav-top a')).toHaveText(['Upcoming','Assignments','Lecture Notes']);
  await seed(page); await enter(page,'student');
  await expect(page.locator('[data-next-class]')).toHaveText('Week 2 · AI Infrastructure · Jan 17, 2027');
  await expect(page.locator('[data-reading-block]')).toContainText('DeepSeek FAQ');
  await expect(page.locator('[data-reading-total]')).toHaveText(/Total: \d+ min/);
  await expect(page.getByRole('link',{name:'Go to Week 2 Library →'})).toHaveAttribute('href','/library/ai-infrastructure/');
  await expect(page.locator('#upcoming-milestone a')).toHaveAttribute('href','/materials/assignments/#milestone-2');
  await page.clock.setFixedTime(new Date('2027-01-18T15:00:00Z')); await page.reload(); await ready(page);
  await expect(page.locator('[data-next-class]')).toContainText('Week 3');
  await page.clock.setFixedTime(new Date('2027-02-01T15:00:00Z')); await page.reload(); await ready(page);
  await expect(page.locator('[data-next-class]')).toHaveText('All scheduled classes have finished.');
  await expect(page.locator('.upcoming-columns')).toHaveCount(0);
  await expect(page.locator('#upcoming-announcements')).toBeVisible();
});

test('Upcoming blocks follow each role, notes visibility, and read-only student preview', async ({page}) => {
  await seed(page);
  for (const role of ['student','grader','instructor','auditor']) {
    await enter(page,role);
    await expect(page.locator('[data-reading-block]')).toBeVisible();
    await expect(page.locator('#upcoming-announcements h3')).toHaveText(['Latest notice','Earlier notice']);
    await expect(page.locator('#upcoming-milestone')).toHaveCount(role === 'auditor' ? 0 : 1);
    await expect(page.locator('#upcoming-groups')).toHaveCount(role === 'student' ? 1 : 0);
    if (role === 'auditor') {
      await expect(page.locator('#upcoming-notes')).not.toContainText('Enrolled students PDF');
      await expect(page.locator('#upcoming-notes')).toContainText('Previous class PDF');
      await expect(page.locator('#upcoming-notes')).toContainText("This week's notes: posted after class");
      await expect(page.locator('#materials-root')).not.toContainText('Demo milestone');
    } else await expect(page.locator('#upcoming-notes')).toContainText('Enrolled students PDF');
  }
  await enter(page,'instructor');
  await page.locator('[data-view-select]').selectOption('ab1234');
  await expect(page.locator('[data-preview-banner]')).toBeVisible();
  await expect(page.locator('#upcoming-milestone')).toBeVisible();
  await expect(page.locator('#upcoming-groups')).toContainText('Sign up for Week 2 lab by');
  const denied = await page.evaluate(async () => {
    const b = (await import('/assets/materials/demo.js')).createDemo();
    const errors = [];
    for (const action of [() => b.saveAnnouncement({body:'Forbidden'}), () => b.saveAnnouncement({id:'newer',body:'Forbidden'}), () => b.deleteAnnouncement('newer')]) {
      try { await action(); } catch (e) { errors.push(e.message); }
    }
    return errors;
  });
  expect(denied).toHaveLength(3);
  await enter(page,'unlisted'); await expect(page.locator('#materials-root')).toContainText('not on the class list');
  await page.evaluate(() => sessionStorage.clear()); await page.reload(); await ready(page);
  await expect(page.locator('#materials-root')).toContainText('Sign in to see course materials.');
});

test('group reminders show only open sign-ups and the student’s own teammates', async ({page}) => {
  await seed(page); await enter(page,'student');
  await expect(page.locator('#upcoming-groups')).toContainText('Sign up for Week 2 lab by');
  await page.evaluate(async () => (await import('/assets/materials/demo.js')).createDemo().chooseGroup('demo-set','demo-group-1'));
  await page.reload(); await ready(page);
  await expect(page.locator('#upcoming-groups')).toContainText('Your group: Group 1 (Second Student)');
  await expect(page.locator('#upcoming-groups')).not.toContainText('Sign up');
  await page.evaluate(async () => (await import('/assets/materials/demo.js')).createDemo().chooseGroup('demo-set',null));
  await page.clock.setFixedTime(new Date('2027-01-21T15:00:00Z')); await page.reload(); await ready(page);
  await expect(page.locator('#upcoming-groups')).toHaveCount(0);
});

test('instructor posts, edits, and deletes short announcements with literal text', async ({page}) => {
  await enter(page,'instructor','settings');
  const editor = page.locator('#announcements-editor'); await editor.locator('> summary').click();
  await page.locator('#announcement-new').getByLabel('Title (optional)').fill('Class update');
  await page.locator('#announcement-new').getByLabel('Announcement text').fill('<img src=x onerror=alert(1)>\nBring your notes.');
  await page.getByRole('button',{name:'Post announcement',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement posted.');
  await page.goto('/materials/upcoming/'); await ready(page);
  await expect(page.locator('#upcoming-announcements')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#upcoming-announcements img')).toHaveCount(0);
  await page.goto('/materials/settings/'); await ready(page); await editor.locator('> summary').click();
  await editor.locator('.announcement-editor summary').click();
  await editor.locator('.announcement-editor').getByLabel('Announcement text').fill('Updated class notice.');
  await page.getByRole('button',{name:'Save announcement',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement saved.');
  await editor.locator('.announcement-editor summary').click();
  page.once('dialog', d => d.accept()); await page.getByRole('button',{name:'Delete announcement',exact:true}).click();
  await expect(page.locator('[data-admin-status]')).toHaveText('Announcement deleted.');
  await page.goto('/materials/upcoming/'); await ready(page);
  await expect(page.locator('#upcoming-announcements')).toContainText('No announcements yet.');
});

test('gradebook uses codes, a closed legend, and code CSV exports that can be reimported', async ({page}) => {
  await enter(page,'instructor','gradebook');
  const legend = page.locator('#grade-legend');
  await expect(legend).not.toHaveAttribute('open',''); await legend.locator('summary').click();
  await expect(legend).toContainText('Q1 → In-class quiz 1 → 3 points');
  await expect(legend).toContainText('Optional tasks are capped at 15 points total');
  await expect(legend).toContainText('A quiz score marks attendance present');
  const q1 = page.locator('.gradebook-grid thead th[title="In-class quiz 1"]');
  await expect(q1).toContainText('Q1'); await expect(q1.locator('.grade-max')).toHaveText('/3');
  await expect(page.getByLabel('Gradebook item').locator('option').nth(7)).toHaveText('Q1');
  const downloading = page.waitForEvent('download'); await page.getByRole('button',{name:'Export gradebook CSV',exact:true}).click();
  const csv = readFileSync(await (await downloading).path(),'utf8');
  expect(csv.split('\r\n')[0]).toBe('"UNI","Name","M1","M2","M3","M4","M5","FP","Q1","Q2","Q3","Q4","Q5","PA","O1","O2","O3","O4","Optional capped","Total"');
  await page.getByLabel('Gradebook item').selectOption('7');
  const singleDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Export In-class quiz 1 CSV',exact:true}).click();
  expect(readFileSync(await (await singleDownload).path(),'utf8').split('\r\n')[0]).toBe('"UNI","Q1"');
  await page.locator('#grade-import summary').click();
  await page.getByLabel('Grade CSV',{exact:true}).setInputFiles({name:'grades.csv',mimeType:'text/csv',buffer:Buffer.from('UNI,Q1\nab1234,0')});
  await page.getByRole('button',{name:'Preview grade import',exact:true}).click();
  await page.getByRole('button',{name:'Import scores',exact:true}).click();
  await expect(page.getByLabel('ab1234 In-class quiz 1',{exact:true})).toHaveValue('0');
  await enter(page,'grader','gradebook');
  await expect(page.locator('.release-label')).toHaveCount(0);
  await expect(page.locator('#grade-legend')).not.toHaveAttribute('open','');
});

for (const width of [1440,390]) test(`Upcoming and gradebook render compactly at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000}); await seed(page);
  mkdirSync('evidence/upcoming',{recursive:true});
  for (const role of ['student','auditor','instructor']) {
    await enter(page,role);
    const boxes = await page.locator('.upcoming-columns > section').evaluateAll(nodes => nodes.map(n=>n.getBoundingClientRect().toJSON()));
    if (width > 819) expect(new Set(boxes.map(b=>b.top)).size).toBe(1);
    else for (let i=1;i<boxes.length;i++) expect(boxes[i].top).toBeGreaterThan(boxes[i-1].bottom);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`evidence/upcoming/${role}-${width}.png`,fullPage:true});
  }
  await enter(page,'instructor','gradebook'); await page.locator('#grade-legend summary').click();
  await page.screenshot({path:`evidence/upcoming/gradebook-${width}.png`,fullPage:true});
  await enter(page,'instructor','settings'); await page.locator('#announcements-editor > summary').click();
  await page.screenshot({path:`evidence/upcoming/settings-${width}.png`,fullPage:true});
});
