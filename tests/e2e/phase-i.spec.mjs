import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter = async (page,week=1) => { await page.goto(`/materials/preparation/week-${week}/?fakeauth=instructor`); await ready(page); };
const section = (page,name) => page.locator('[data-prep-section]').filter({has:page.locator('.prep-section-heading').getByRole('heading',{name,exact:true})});
const noteBody = page => page.evaluate(async () => (await (await import('/assets/materials/demo.js')).createDemo().instructorNote(1)).body);
const edit = async panel => panel.locator('.prep-section-heading button').click();
const save = async panel => { await panel.getByRole('button',{name:'Save',exact:true}).click(); await expect(panel.locator('[data-prep-status]')).toContainText('Saved'); };
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-15T20:42:00Z'));
});

test('every week renders its public outline and no reading links and no editor on load',async ({page}) => {
  for (let week=1;week<=6;week++) {
    await enter(page,week);
    const outline = await page.locator('[data-preparation-outline]').evaluate(n => JSON.parse(n.textContent));
    const expected = ['Introduction',...outline.topics.map(t=>t.name),'Quiz (3 questions)',...outline.exercises,'Milestone','Logistics',...(week===1?['Other notes']:[])];
    expect(await page.locator('.prep-section-heading :is(h2,h3)').allTextContents()).toEqual(expected);
    await expect(page.locator('.preparation-goal')).toHaveText(outline.goal);
    await expect(page.locator('.preparation-exercises > h2')).toHaveText('In-class exercises');
    expect(await page.locator('.preparation-exercises h3').allTextContents()).toEqual(outline.exercises);
    await expect(section(page,'Milestone').locator('.prep-reference')).toHaveText(outline.milestone);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('.prep-reading-list, .prep-reading-level')).toHaveCount(0);
    await expect(page.locator('main h1').first()).toHaveText(new RegExp(`^Week ${week}: `));
    for (const panel of await page.locator('.preparation-section').all()) {
      for (const edge of ['left','right','bottom']) await expect(panel).toHaveCSS(`border-${edge}-width`,'0px');
      expect(await panel.locator('.prep-section-heading :is(h2,h3)').evaluate(n=>getComputedStyle(n).fontFamily)).toContain('Source Serif');
    }
  }
});

test('each section edits, cancels, saves, and reloads independently while legacy notes survive',async ({page}) => {
  await enter(page);
  const original = await noteBody(page);
  const names = await page.locator('[data-prep-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.prepSection));
  for (const name of names.filter(n=>n!=='Other notes')) {
    const panel = section(page,name); await edit(panel);
    await expect(page.getByRole('textbox')).toHaveCount(1);
    const input=panel.getByRole('textbox'); await input.fill('Discard this draft');
    await panel.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(panel.locator('[data-prep-markdown]')).not.toContainText('Discard this draft');
    await edit(panel); await expect(input).toHaveValue('');
    await input.fill(`**Saved for ${name}**\n\n## Logistics\nKeep this nested heading here.`); await save(panel);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(panel.locator('[data-prep-markdown] strong')).toHaveText(`Saved for ${name}`);
  }
  await page.reload(); await ready(page);
  for (const name of names.filter(n=>n!=='Other notes')) {
    const panel=section(page,name); await expect(panel.locator('[data-prep-markdown]')).toContainText(`Saved for ${name}`);
    await edit(panel); await expect(panel.getByRole('textbox')).toHaveValue(`**Saved for ${name}**\n\n## Logistics\nKeep this nested heading here.`);
    await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  await edit(section(page,'Other notes')); await expect(section(page,'Other notes').getByRole('textbox')).toHaveValue(original);
});

test('saving one section preserves other drafts; oversized saves keep the draft and leave stored notes intact',async ({page}) => {
  await enter(page);
  const first=section(page,'Economic Frameworks for AI'), quiz=section(page,'Quiz (3 questions)');
  await edit(first); await first.getByRole('textbox').fill('Saved topic draft');
  await edit(quiz); await quiz.getByRole('textbox').fill('Unsaved quiz draft');
  await save(first); await expect(quiz.getByRole('textbox')).toHaveValue('Unsaved quiz draft');
  expect(await noteBody(page)).not.toContain('Unsaved quiz draft');
  await page.locator('.staff-menu summary').click(); await page.locator('.staff-menu').getByRole('link',{name:'Speakers',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Unsaved changes'); await page.getByRole('button',{name:'Keep editing'}).click();
  await save(quiz); const before=await noteBody(page);
  await edit(first); await first.getByRole('textbox').fill('x'.repeat(50000));
  await first.getByRole('button',{name:'Save',exact:true}).click();
  await expect(first.locator('[data-prep-status]')).toContainText('50,000');
  await expect(first.getByRole('textbox')).toHaveValue('x'.repeat(50000)); expect(await noteBody(page)).toBe(before);
  await first.getByRole('button',{name:'Cancel',exact:true}).click(); await edit(first);
  await expect(first.getByRole('textbox')).toHaveValue('Saved topic draft');
  await first.getByRole('textbox').fill('Updated topic draft'); await save(first); await page.reload(); await ready(page);
  await expect(quiz.locator('[data-prep-markdown]')).toHaveText('Unsaved quiz draft');
  await expect(first.locator('[data-prep-markdown]')).toHaveText('Updated topic draft');
});

for (const width of [1440,390,320]) test(`Preparation stays on the page and its one open editor grows without a box at ${width}px`,async ({page}) => {
  await page.setViewportSize({width,height:1000}); await enter(page);
  await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    const {preparationSections,parsePreparation,serializePreparation}=await import('/assets/materials/prep-outline-core.js');
    const names=preparationSections(JSON.parse(document.querySelector('[data-preparation-outline]').textContent)).map(s=>s.name);
    const notes=parsePreparation('',names);
    notes['Economic Frameworks for AI']='**Opening discussion**\n\n- Compare prediction and judgment in a financial decision.\n- Ask which inputs remain scarce when prediction becomes cheaper.';
    notes['Quiz (3 questions)']='1. Identify a prediction task.\n2. Explain a complement to prediction.\n3. State one limit of the framework.';
    await b.saveInstructorNote(1,serializePreparation(notes,names));
  });
  await page.reload(); await ready(page); await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  if (width===1440) {
    mkdirSync('evidence/phase-i',{recursive:true});
    await page.screenshot({path:'evidence/phase-i/preparation-week-1-view.png',fullPage:true});
  }
  const first=section(page,'Economic Frameworks for AI'); await edit(first);
  const input=first.getByRole('textbox'); await expect(input).toBeVisible(); await expect(page.getByRole('textbox')).toHaveCount(1);
  for (const edge of ['top','left','right']) await expect(input).toHaveCSS(`border-${edge}-width`,'0px');
  await expect(input).toHaveCSS('border-bottom-width','1px'); await expect(input).toHaveCSS('box-shadow','none');
  if (width===1440) {
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:'evidence/phase-i/preparation-week-1-edit.png',fullPage:true});
  }
  const height=await input.evaluate(n=>n.getBoundingClientRect().height);
  await input.fill(Array.from({length:30},(_,i)=>`Line ${i+1}: synthetic draft with enough text to wrap on a narrow screen.`).join('\n'));
  expect(await input.evaluate(n=>n.getBoundingClientRect().height)).toBeGreaterThan(height);
  expect(await input.evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);
  await input.fill('Short note'); expect(await input.evaluate(n=>n.getBoundingClientRect().height)).toBeLessThan(height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Speakers use all six Library week headings and Unscheduled, with safe fields, filter, and inline reassignment',async ({page}) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/materials/speakers/?fakeauth=instructor'); await ready(page);
  await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for (const row of await b.speakers()) await b.deleteSpeaker(row.id);
    for (let week=1;week<=6;week++) await b.saveSpeaker({name:`Example guest ${week}`,affiliation:'Example Finance',topic:'AI in financial decisions',week,status:['Idea','Contacted','Confirmed','Declined'][week%4],contact:`guest${week}@example.test`,notes:'Synthetic planning note. Confirm the discussion format.'});
    await b.saveSpeaker({name:'Unscheduled guest',affiliation:'Example Research',topic:'Research workflows',week:null,status:'Idea',contact:'https://example.test/contact',notes:'Synthetic planning note. Date to be discussed.'});
  });
  await page.reload(); await ready(page); await page.evaluate(()=>document.fonts.ready);
  const weeks = await page.locator('[data-speaker-weeks]').evaluate(n=>JSON.parse(n.textContent));
  expect(await page.locator('.speaker-week > h2').allTextContents()).toEqual([...weeks.map(w=>`Week ${w.week} · ${w.title}`),'Unscheduled']);
  await expect(page.locator('#materials-root table')).toHaveCount(0);
  for (const week of [...weeks,{week:'unscheduled'}]) {
    const group=page.locator(`[data-speaker-week="${week.week}"]`); await expect(group.locator('.speaker-row')).toHaveCount(1);
    expect(await group.locator('h2').evaluate(n=>getComputedStyle(n).fontFamily)).toContain('Source Serif');
    await expect(group.locator('.speaker-status')).toHaveCount(0);
    await expect(group.locator('.speaker-row h3 a')).toHaveAttribute('rel','noopener noreferrer');
    for (const row of await group.locator('.speaker-row').all()) expect((await row.boundingBox()).height).toBeLessThan(40);
    for (const edge of ['left','right','bottom']) await expect(group).toHaveCSS(`border-${edge}-width`,'0px');
    for (const row of await group.locator('.speaker-row').all()) await expect(row).toHaveCSS('border-top-width','0px');
  }
  mkdirSync('evidence/phase-i',{recursive:true}); await page.screenshot({path:'evidence/phase-i/speakers-1440.png',fullPage:true});
  const first=page.locator('[data-speaker-week="1"] .speaker-row'); await first.getByRole('button',{name:'Edit',exact:true}).click();
  await first.getByLabel('Week',{exact:true}).selectOption(''); await first.getByLabel('Notes',{exact:true}).fill('<img src=x onerror="window.speakerXss=1">');
  await first.getByRole('button',{name:'Save speaker'}).click();
  const unscheduled=page.locator('[data-speaker-week="unscheduled"]'); await expect(unscheduled.locator('.speaker-row')).toHaveCount(2);
  await expect(unscheduled.locator('img,script')).toHaveCount(0); expect(await page.evaluate(()=>window.speakerXss)).toBeUndefined();
  await page.getByLabel('Filter speakers').fill('Example guest 1'); await expect(page.locator('.speaker-row')).toHaveCount(1);
  await expect(unscheduled.locator('h3')).toHaveText('Example guest 1');
  await page.getByLabel('Filter speakers').fill(''); await page.reload(); await ready(page);
  await expect(unscheduled.locator('.speaker-row')).toHaveCount(2);
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:900}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
