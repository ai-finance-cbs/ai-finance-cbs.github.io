import { test, expect } from '@playwright/test';
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter = async page => { await page.goto('/materials/preparation/week-1/?fakeauth=instructor'); await ready(page); };
const card = (page,name) => page.locator('[data-prep-section]').filter({has:page.locator('.prep-section-heading').getByRole('heading',{name:new RegExp(`^(Lecture: |In-Class Exercise: )?${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)})});
const names = (page,group='plan') => page.locator(`.preparation-${group} > [data-prep-section]`).evaluateAll(nodes=>nodes.map(n=>n.dataset.prepSection));
const body = page => page.evaluate(async () => (await (await import('/assets/materials/demo.js')).createDemo().instructorNote(1)).body);
const settings = async (page,name) => {
  const panel=card(page,name); await panel.getByRole('button',{name:`Card settings for ${name}`,exact:true}).click();
  return panel.locator('.prep-card-form');
};
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
});

test('keyboard moves materialize the visible plan, preserve notes, and update Contents after reload',async ({page}) => {
  await enter(page);
  const original=await body(page), before=await names(page), moving=before[2];
  const panel=card(page,moving);
  await panel.locator('.prep-content-edit').click();
  await panel.getByRole('textbox').fill('Keep this card content');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(panel.locator('[data-prep-status]')).toContainText('Saved');
  const legacy=await body(page); expect(legacy).not.toContain('preparation-layout v1');
  let form=await settings(page,moving); await form.getByRole('button',{name:'Move up',exact:true}).click();
  const expected=[before[0],before[2],before[1],...before.slice(3)];
  await expect.poll(()=>names(page)).toEqual(expected);
  expect(await body(page)).toContain('<!-- preparation-layout v1 -->');
  expect(await body(page)).toContain(original);
  await expect(card(page,moving).locator('[data-prep-markdown]')).toHaveText('Keep this card content');
  await page.reload(); await ready(page); expect(await names(page)).toEqual(expected);
  const planHeadings=await page.locator('.preparation-plan .prep-section-heading > h2').allTextContents();
  expect((await page.locator('#outline a').allTextContents()).slice(1,1+expected.length)).toEqual(planHeadings);
  await panel.locator('.prep-content-edit').click();
  await panel.getByRole('textbox').fill('Content edited after layout conversion');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await expect(panel.locator('[data-prep-status]')).toContainText('Saved');
  await page.reload(); await ready(page);
  expect(await names(page)).toEqual(expected);
  await expect(panel.locator('[data-prep-markdown]')).toHaveText('Content edited after layout conversion');
  expect(await body(page)).toContain(original);
  form=await settings(page,moving); await form.getByRole('button',{name:'Move down',exact:true}).click();
  await expect.poll(()=>names(page)).toEqual(before);
  await expect(card(page,'Logistics').locator('.prep-card-toggle,.prep-drag-grip')).toHaveCount(0);
  expect(await page.locator('[data-prep-section]').first().getAttribute('data-prep-section')).toBe('Logistics');
});

test('renaming and type changes preserve content, derive prefixes and colors, and validate titles',async ({page}) => {
  await enter(page); const first=(await names(page))[0];
  await card(page,first).locator('.prep-content-edit').click(); await card(page,first).getByRole('textbox').fill('Opening content');
  await card(page,first).getByRole('button',{name:'Save',exact:true}).click();
  await expect(card(page,first).locator('[data-prep-status]')).toContainText('Saved');
  let form=await settings(page,first);
  await form.getByLabel('Card title').fill('Opening discussion'); await form.getByLabel('Card type').selectOption('exercise');
  await form.getByRole('button',{name:'Save',exact:true}).click();
  const renamed=card(page,'Opening discussion');
  await expect(renamed.getByRole('heading',{name:'In-Class Exercise: Opening discussion',exact:true})).toBeVisible();
  await expect(renamed).toHaveCSS('background-color','rgb(241, 246, 252)');
  await expect(renamed.locator('[data-prep-markdown]')).toHaveText('Opening content');
  expect(await body(page)).toContain('## Opening discussion\n<!-- preparation-section kind=exercise -->');
  form=await settings(page,'Opening discussion'); await form.getByLabel('Card type').selectOption('quiz');
  await form.getByRole('button',{name:'Save',exact:true}).click();
  await expect(renamed.getByRole('heading',{name:'Opening discussion',exact:true})).toBeVisible();
  await expect(renamed).toHaveCSS('background-color','rgb(251, 244, 244)');
  form=await settings(page,'Opening discussion');
  for (const [title,error] of [['Logistics','reserved'],['Other notes','reserved'],[(await names(page))[1].toUpperCase(),'unique'],['Lecture: Double prefix','without its type prefix']]) {
    await form.getByLabel('Card title').fill(title); await form.getByRole('button',{name:'Save',exact:true}).click();
    await expect(form.getByRole('status')).toContainText(error);
  }
  await form.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.reload(); await ready(page); await expect(renamed.locator('[data-prep-markdown]')).toHaveText('Opening content');
  await expect(renamed.getByRole('heading',{name:'Opening discussion',exact:true})).toBeVisible();
});

test('add empty cards to both groups, move between groups, and confirm deletion',async ({page}) => {
  await enter(page);
  for (const group of ['plan','Appendix']) {
    await page.getByRole('button',{name:`Add card to ${group}`,exact:true}).click();
    const form=page.getByRole('form',{name:`Add card to ${group}`,exact:true});
    await form.getByLabel('Card title').fill(`New ${group} card`);
    await form.getByLabel('Card type').selectOption('exercise');
    await form.getByRole('button',{name:'Save',exact:true}).click();
    await expect(card(page,`New ${group} card`)).toBeVisible();
  }
  await page.reload(); await ready(page);
  expect((await names(page)).at(-1)).toBe('New plan card');
  expect((await names(page,'appendix')).at(-1)).toBe('New Appendix card');
  let form=await settings(page,'New plan card'); await form.getByRole('button',{name:'Move to Appendix',exact:true}).click();
  await expect.poll(()=>names(page,'appendix')).toContain('New plan card');
  await expect(page.locator('#outline').getByRole('link',{name:'In-Class Exercise: New plan card',exact:true})).toBeVisible();
  form=await settings(page,'New plan card'); await form.getByRole('button',{name:'Move to plan',exact:true}).click();
  await expect.poll(()=>names(page)).toContain('New plan card');
  form=await settings(page,'New plan card'); await form.getByRole('button',{name:'Delete card',exact:true}).click();
  await expect(form.locator('.inline-confirm')).toContainText('and its notes?');
  await form.locator('.inline-confirm').getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(card(page,'New plan card')).toBeVisible();
  await form.getByRole('button',{name:'Delete card',exact:true}).click();
  await form.locator('.inline-confirm').getByRole('button',{name:'Confirm',exact:true}).click();
  await expect(card(page,'New plan card')).toHaveCount(0);
  await page.reload(); await ready(page); await expect(card(page,'New plan card')).toHaveCount(0);
  expect(await names(page,'appendix')).toContain('New Appendix card');
});

test('native drag saves order and cross-group moves; a failed drop keeps the previous order and notes',async ({page}) => {
  await enter(page); const before=await names(page), moving=before[2], original=await body(page);
  await page.evaluate(() => {
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value) {
      if (key==='b8403-demo-state-v3') { Storage.prototype.setItem=set; throw new Error('Test layout save failed.'); }
      return set.call(this,key,value);
    };
  });
  await card(page,moving).locator('.prep-drag-grip').dragTo(card(page,before[0]),{targetPosition:{x:20,y:2}});
  await expect(page.locator('[data-prep-layout-status]')).toHaveText('Test layout save failed.');
  expect(await names(page)).toEqual(before); expect(await body(page)).toBe(original);
  await card(page,moving).locator('.prep-drag-grip').dragTo(card(page,before[0]),{targetPosition:{x:20,y:2}});
  await expect.poll(()=>names(page)).toEqual([moving,...before.filter(n=>n!==moving)]);
  await expect(page.locator('[data-prep-layout-status]')).toHaveText('Saved');
  // Start the native drag before scrolling to an off-screen destination.
  const grip=card(page,moving).locator('.prep-drag-grip');
  await grip.hover(); const start=await grip.boundingBox();
  await page.mouse.down(); await page.mouse.move(start.x+start.width/2+12,start.y+start.height/2,{steps:3});
  const destination=page.locator('.preparation-appendix > h2');
  await destination.scrollIntoViewIfNeeded(); const end=await destination.boundingBox();
  await page.mouse.move(end.x+20,end.y+end.height/2,{steps:3});
  await page.mouse.move(end.x+21,end.y+end.height/2); await page.mouse.up();
  await expect.poll(()=>names(page,'appendix')).toContain(moving);
  await page.reload(); await ready(page); expect(await names(page,'appendix')).toContain(moving);
});

test('unsaved content disables every layout action and preserves other open drafts',async ({page}) => {
  await enter(page); const [first,second]=await names(page);
  await card(page,first).locator('.prep-content-edit').click(); await card(page,first).getByRole('textbox').fill('First draft');
  for (const control of await page.locator('.prep-card-toggle,.prep-drag-grip,.prep-add-card').all()) await expect(control).toBeDisabled();
  for (const grip of await page.locator('.prep-drag-grip').all()) await expect(grip).toHaveAttribute('draggable','false');
  await card(page,second).locator('.prep-content-edit').click(); await card(page,second).getByRole('textbox').fill('Second draft');
  await card(page,first).getByRole('button',{name:'Save',exact:true}).click();
  await expect(card(page,first).locator('[data-prep-status]')).toContainText('Saved');
  await expect(card(page,second).getByRole('textbox')).toHaveValue('Second draft');
  await expect(page.getByRole('button',{name:'Add card to plan',exact:true})).toBeDisabled();
  await page.locator('.topbar .preparation-nav a').nth(1).click();
  await expect(page.getByRole('alert')).toContainText('Unsaved changes'); await page.getByRole('button',{name:'Keep editing'}).click();
  await card(page,second).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add card to plan',exact:true})).toBeEnabled();
  const form=await settings(page,first); await form.getByLabel('Card title').fill('Unsaved title');
  await expect(form.getByRole('button',{name:'Move down',exact:true})).toBeDisabled();
  await expect(card(page,second).locator('.prep-content-edit')).toBeDisabled();
  await form.getByRole('button',{name:'Cancel',exact:true}).click();
});

for (const width of [1440,390,320]) test(`card settings fit at ${width}px`,async ({page}) => {
  await page.setViewportSize({width,height:1000}); await enter(page);
  const form=await settings(page,(await names(page))[0]);
  await expect(form.getByLabel('Card title')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/prep-editor/controls-${width}.png`,fullPage:true});
});

for (const role of ['grader','student','auditor','unlisted','preview']) test(`${role} cannot see or write card layouts`,async ({page}) => {
  if (role==='preview') {
    await enter(page); await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');
    await expect(page.locator('[data-preview-banner]')).toBeVisible();
    await page.goto('/materials/preparation/week-1/');
  } else await page.goto(`/materials/preparation/week-1/?fakeauth=${role}`);
  await ready(page);
  await expect(page.locator('.prep-card-toggle,.prep-drag-grip,.prep-add-card,.preparation-section')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    try { await b.saveInstructorNote(1,'<!-- preparation-layout v1 -->\n'); return 'allowed'; } catch (e) { return e.message; }
  })).toContain('Instructor access required');
});
