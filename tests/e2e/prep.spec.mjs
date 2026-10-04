import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter = async (page, role = 'instructor', slug = 'preparation/week-1') => { await page.goto(`/materials/${slug}/?fakeauth=${role}`); await ready(page); };
const root = page => page.locator('#materials-root');
const section = (page,name='Other notes') => page.locator('[data-prep-section]').filter({has:page.locator('.prep-section-heading').getByRole('heading',{name,exact:true})});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
});

test('both tabs and all preparation weeks belong only to instructors; other roles cannot fetch demo data', async ({page}) => {
  for (const role of ['instructor','grader','student','auditor','unlisted']) {
    await enter(page,role);
    for (const name of ['Preparation','Speakers']) await expect(page.locator('.topnav').getByRole('link',{name,exact:true})).toHaveCount(role === 'instructor' ? 1 : 0);
    if (role === 'instructor') {
      await expect(page.locator('.topbar .preparation-nav a')).toHaveCount(6);
      await expect(page.locator('.topbar .preparation-nav a').first()).toContainText('Week 1AI Economics');
    }
    for (const slug of ['preparation/week-2','speakers']) {
      await page.goto(`/materials/${slug}/`); await ready(page);
      if (role !== 'instructor') { await expect(root(page)).toContainText(role === 'unlisted' ? 'not on the class list' : 'for instructors'); await expect(page.locator('.preparation-section,.preparation-editor,.speaker-row')).toHaveCount(0); }
    }
    if (role !== 'instructor') expect(await page.evaluate(async () => {
      const b = (await import('/assets/materials/demo.js')).createDemo(), results = [];
      for (const task of [()=>b.instructorNote(1),()=>b.speakers(),()=>b.saveInstructorNote(1,'Denied'),()=>b.saveSpeaker({}),()=>b.deleteSpeaker('fake')]) {
        try { await task(); results.push('allowed'); } catch (e) { results.push(e.message); }
      }
      return results;
    })).toEqual(Array(5).fill('Instructor access required.'));
  }
  await page.locator('[data-signout]').click(); await ready(page);
  for (const slug of ['preparation','speakers']) {
    await page.goto(`/materials/${slug}/`); await ready(page); await expect(root(page)).toContainText('Sign in');
    for (const name of ['Preparation','Speakers']) await expect(page.locator('.topnav').getByRole('link',{name,exact:true})).toHaveCount(0);
  }
});

test('notes save explicitly, survive reload, remain separate by week, and render safe Markdown', async ({page}) => {
  await enter(page); await section(page).getByRole('button',{name:'Edit Other notes',exact:true}).click();
  const markdown = '# Opening\n\n**Evidence** and *judgment*\n\n- First\n- Second\n\n[Reading](https://example.test/read)\n<script>window.prepXss=1</script>\n<img src=x onerror="window.prepXss=2">\n[Unsafe](javascript:alert)';
  await page.getByLabel('Other notes',{exact:true}).fill(markdown);
  await expect(section(page).locator('[data-prep-status]')).toHaveText('Unsaved changes');
  await section(page).getByRole('button',{name:'Save',exact:true}).click();
  await expect(section(page).locator('[data-prep-status]')).toHaveText(/Saved \d{1,2}:\d{2} [AP]M/);
  await page.reload(); await ready(page);
  const rendered = section(page).locator('[data-prep-markdown]');
  await expect(rendered.getByRole('heading',{name:'Opening'})).toBeVisible();
  await expect(rendered.locator('strong')).toHaveText('Evidence'); await expect(rendered.locator('em')).toHaveText('judgment');
  await expect(rendered.locator('li')).toHaveCount(2); await expect(rendered.locator('script,img')).toHaveCount(0);
  await expect(rendered).toContainText('<script>window.prepXss=1</script>'); expect(await page.evaluate(() => window.prepXss)).toBeUndefined();
  await expect(rendered.locator('a')).toHaveCount(1);
  await section(page).getByRole('button',{name:'Edit Other notes',exact:true}).click(); await expect(page.getByLabel('Other notes',{exact:true})).toHaveValue(markdown);
  await page.locator('.topbar .preparation-nav a').nth(1).click(); await ready(page);
  const logistics=section(page,'Logistics'); await logistics.getByRole('button',{name:'Add Logistics notes'}).click();
  await expect(page.getByLabel('Logistics notes',{exact:true})).toHaveValue('');
  await page.getByLabel('Logistics notes',{exact:true}).fill('Week two only'); await logistics.getByRole('button',{name:'Save',exact:true}).click();
  await expect(logistics.locator('[data-prep-status]')).toContainText('Saved');
  await page.locator('.topbar .preparation-nav a').first().click(); await ready(page);
  await expect(section(page).locator('[data-prep-markdown]')).toContainText('Evidence'); await expect(root(page)).not.toContainText('Week two only');
});

test('unsaved changes warn inline on navigation and sign-out, and in the browser on reload', async ({page}) => {
  await enter(page); await section(page).getByRole('button',{name:'Edit Other notes',exact:true}).click();
  await page.getByLabel('Other notes',{exact:true}).fill('Unsaved draft');
  await page.locator('.topnav').getByRole('link',{name:'Speakers',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Unsaved changes');
  await page.getByRole('button',{name:'Keep editing'}).click(); await expect(page.getByLabel('Other notes',{exact:true})).toHaveValue('Unsaved draft');
  const warning = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => location.reload(),0); });
  const dialog = await warning; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
  await expect(page.getByLabel('Other notes',{exact:true})).toHaveValue('Unsaved draft');
  await page.locator('[data-signout]').click(); await expect(page.getByRole('alert')).toContainText('Unsaved changes');
  await page.getByRole('button',{name:'Keep editing'}).click(); await expect(page.locator('[data-role]')).toHaveText('Instructor');
  await page.locator('.topnav').getByRole('link',{name:'Speakers',exact:true}).click();
  await page.getByRole('button',{name:'Leave without saving'}).click(); await ready(page); await expect(page).toHaveURL(/\/speakers\/$/);
  await page.goto('/materials/preparation/week-1/'); await ready(page); await expect(root(page)).not.toContainText('Unsaved draft');
});

test('preview warns about unsaved notes and then denies both workspace pages and backend methods', async ({page}) => {
  await enter(page); await section(page).getByRole('button',{name:'Edit Other notes',exact:true}).click(); await page.getByLabel('Other notes',{exact:true}).fill('Preview draft');
  await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');
  await page.getByRole('button',{name:'Keep editing'}).click(); await expect(page.locator('[data-view-select]')).toHaveValue('');
  await page.getByLabel('View as student',{exact:true}).selectOption('ab1234'); await page.getByRole('button',{name:'Leave without saving'}).click();
  await expect(page).toHaveURL(/\/attendance\/$/); await ready(page);
  for (const slug of ['preparation/week-1','speakers']) {
    await page.goto(`/materials/${slug}/`); await ready(page); await expect(root(page)).toContainText('for instructors');
    await expect(page.locator('.topnav').getByRole('link',{name:'Preparation',exact:true})).toHaveCount(0);
    await expect(page.locator('.topnav').getByRole('link',{name:'Speakers',exact:true})).toHaveCount(0);
  }
  expect(await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo(), result=[];
    for (const task of [()=>b.instructorNote(1),()=>b.speakers(),()=>b.saveInstructorNote(1,'Forbidden'),()=>b.saveSpeaker({}),()=>b.deleteSpeaker('fake')]) try {await task();result.push('allowed');} catch(e) {result.push(e.message);}
    return result;
  })).toEqual(Array(5).fill('Instructor access required.'));
});

test('speaker add, inline edit, filtering, ordering, confirmed delete, and reload work', async ({page}) => {
  await enter(page,'instructor','speakers'); await expect(page.locator('.speaker-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Add speaker',exact:true}).click();
  const form=page.getByRole('form',{name:'Add speaker',exact:true});
  await form.getByLabel('Name',{exact:true}).fill('A new guest'); await form.getByLabel('Affiliation').fill('Example Bank'); await form.getByLabel('Topic').fill('Credit decisions');
  await form.getByLabel('Week',{exact:true}).selectOption('2'); await form.getByLabel('Status').selectOption('Idea');
  await form.getByLabel('Contact').fill('guest@example.test'); await form.getByLabel('Notes',{exact:true}).fill('<script>window.speakerXss=1</script>');
  await form.getByRole('button',{name:'Save speaker'}).click(); await expect(page.locator('.speaker-row')).toHaveCount(4);
  await expect(page.locator('.speaker-row h3').first()).toHaveText('A new guest');
  const id=await page.locator('.speaker-row').filter({hasText:'A new guest'}).getAttribute('data-speaker-id');
  const row=page.locator(`[data-speaker-id="${id}"]`);
  await expect(row.locator('script')).toHaveCount(0); await expect(row.getByRole('link',{name:'guest@example.test'})).toHaveAttribute('href','mailto:guest@example.test');
  await row.getByRole('button',{name:'Edit',exact:true}).click(); await row.getByLabel('Name',{exact:true}).fill('Updated guest'); await row.getByLabel('Status').selectOption('Declined'); await row.getByLabel('Week',{exact:true}).selectOption('');
  await row.getByRole('button',{name:'Save speaker'}).click(); await expect(page.locator('.speaker-row h3').last()).toHaveText('Updated guest');
  await page.reload(); await ready(page); await page.getByLabel('Filter speakers').fill('Credit'); await expect(page.locator('.speaker-row')).toHaveCount(1);
  await expect(page.locator('.speaker-row')).toContainText('Declined'); await expect(page.locator('.speaker-heading')).not.toContainText('Week');
  await page.locator('.speaker-row').getByRole('button',{name:'Delete',exact:true}).click(); await expect(page.locator('.inline-confirm')).toContainText('Delete Updated guest?');
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await expect(page.locator('.speaker-row')).toHaveCount(1);
  await page.locator('.speaker-row').getByRole('button',{name:'Delete',exact:true}).click(); await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(page.locator('.speaker-row')).toHaveCount(0); await page.getByLabel('Filter speakers').fill(''); await expect(page.locator('.speaker-row')).toHaveCount(3);
  await page.reload(); await ready(page); await expect(page.locator('.speaker-row')).toHaveCount(3);
});

test('demo notes and speakers persist unchanged across term rollover', async ({page}) => {
  await enter(page);
  expect(await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await b.saveInstructorNote(1,'Carry into Spring 2028');
    const before=await b.speakers(); await b.openTerm('Spring 2028');
    return {body:(await b.instructorNote(1)).body,same:JSON.stringify(before)===JSON.stringify(await b.speakers()),term:(await b.getAccess()).term_id};
  })).toEqual({body:'Carry into Spring 2028',same:true,term:'spring-2028'});
  await page.reload(); await ready(page); await expect(section(page).locator('[data-prep-markdown]')).toHaveText('Carry into Spring 2028');
});

for (const width of [1440,390,320]) test(`instructor workspace fits at ${width}px with unchanged header`, async ({page}) => {
  await page.setViewportSize({width,height:1000}); mkdirSync('evidence/phase-d',{recursive:true});
  for (const slug of ['preparation/week-1','speakers']) {
    await enter(page,'instructor',slug); await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if (width===1440) {
      expect(await page.locator('.topbar').evaluate(n=>n.getBoundingClientRect().height)).toBe(148);
      await page.screenshot({path:`evidence/phase-d/${slug.startsWith('preparation')?'preparation-week-1':'speakers'}-1440.png`,fullPage:true});
    }
  }
});
