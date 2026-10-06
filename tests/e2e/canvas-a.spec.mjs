import {test,expect} from '@playwright/test';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,path='settings',role='instructor')=>{await page.goto(`/materials/${path}/?fakeauth=${role}`);await ready(page);};
test.beforeEach(async({page})=>{await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));});
test('Canvas Settings uses explicit mappings, suggestions, sync status, and unmatched enrollment diagnostics',async({page})=>{
  await enter(page);const row=page.locator('#canvas-settings');await row.locator('summary').click();
  await expect(row.getByLabel('Canvas course ID')).toHaveValue('240315');await expect(row.locator('[data-canvas-health]')).toContainText('Last synced:');
  await expect(row).toContainText('Unmatched enrollments (1)');
  const choice=row.getByLabel('Canvas assignment for Q6',{exact:true});await expect(choice).toHaveValue('');
  await expect(choice.locator('..')).toContainText('Suggested:');
  const value=await choice.locator('option').nth(1).getAttribute('value');
  // A duplicate assignment cannot replace a saved mapping.
  await choice.selectOption(value);await row.getByRole('button',{name:'Save mapping for Q6',exact:true}).click();
  await expect(row.getByRole('status')).toContainText('already mapped');
  const unused=await choice.locator('option').last().getAttribute('value');await choice.selectOption(unused);
  await row.getByRole('button',{name:'Save mapping for Q6',exact:true}).click();await expect(row.getByRole('status')).toHaveText('Mapping saved.');
  await row.getByRole('button',{name:'Sync now',exact:true}).click();await expect(row.getByRole('status')).toHaveText('Sync complete.');
  await page.reload();await ready(page);await page.locator('#canvas-settings summary').click();await expect(page.getByLabel('Canvas assignment for Q6',{exact:true})).toHaveValue(unused);
});
test('Canvas mode is read-only, opens details, and preserves the legacy grade draft when switching modes',async({page})=>{
  await enter(page,'gradebook');const legacy=page.locator('[data-legacy-gradebook]');
  const grade=legacy.locator('input[data-grade]').first();await grade.fill('7');
  await page.getByLabel('Gradebook mode').selectOption('canvas');const canvas=page.locator('[data-canvas-gradebook]');
  await expect(canvas.locator('.canvas-grid')).toBeVisible();await expect(legacy).toBeHidden();
  await expect(canvas.locator('input')).toHaveCount(0);await canvas.getByRole('button',{name:'Demo Student M1: Done',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Canvas submission details'});await expect(popup).toContainText('Score: 8');
  await expect(popup).toContainText('Posted:');await expect(popup.getByRole('link',{name:'Open in CourseWorks →'})).toHaveAttribute('href',/courseworks2.columbia.edu\/courses\/240315\/assignments\//);
  await page.keyboard.press('Escape');await expect(popup).toBeHidden();
  await page.getByLabel('Gradebook mode').selectOption('legacy');await expect(grade).toHaveValue('7');
});
test('grader can read Canvas comparison but cannot configure or sync',async({page})=>{
  await enter(page,'gradebook','grader');await page.getByLabel('Gradebook mode').selectOption('canvas');await expect(page.locator('.canvas-grid')).toBeVisible();
  expect(await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();try{await b.syncCanvas('spring-2027');return 'allowed';}catch(e){return e.message;}})).toContain('Instructor');
  await page.goto('/materials/settings/');await ready(page);await expect(page.locator('#canvas-settings')).toHaveCount(0);
});
for(const role of ['student','auditor','unlisted','preview'])test(`${role} cannot read Canvas mirrors or controls`,async({page})=>{
  if(role==='preview'){await enter(page);await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await expect(page.locator('[data-preview-banner]')).toBeVisible();}
  else await enter(page,'grades',role);
  expect(await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();try{await b.canvasData('spring-2027');return 'allowed';}catch(e){return e.message;}})).toContain('Staff access required');
  await page.goto('/materials/gradebook/');await ready(page);await expect(page.getByLabel('Gradebook mode')).toHaveCount(0);
});
test('header term selection isolates Canvas settings and makes archived settings read-only',async({page})=>{
  await enter(page);await page.evaluate(async()=>{await (await import('/assets/materials/demo.js')).createDemo().openTerm('Spring 2028');});await page.reload();await ready(page);
  await page.getByLabel('Term',{exact:true}).selectOption('spring-2028');await page.locator('#canvas-settings summary').click();
  await expect(page.getByLabel('Canvas course ID')).toHaveValue('');
  await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');await expect(page.getByLabel('Canvas course ID')).toHaveValue('240315');
  await expect(page.getByLabel('Canvas course ID')).toBeDisabled();await expect(page.getByRole('button',{name:'Sync now',exact:true})).toBeDisabled();
});
for(const width of [1440,390,320])test(`Canvas grid and pop-up stay in the right pane at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await enter(page,'gradebook');await page.getByLabel('Gradebook mode').selectOption('canvas');
  await expect(page.locator('.topbar')).toBeVisible();
  if(width>819)await expect(page.locator('.site-sidebar')).toBeVisible();
  const grid=await page.locator('.canvas-grid').boundingBox();expect(grid.x).toBeGreaterThanOrEqual(width>819?240:0);
  await page.getByRole('button',{name:'Demo Student M1: Done',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Canvas submission details'}),box=await popup.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(width>819?240:0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/canvas-a/grid-${width}.png`,fullPage:true});
  await enter(page);await page.locator('#canvas-settings summary').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/canvas-a/settings-${width}.png`,fullPage:true});
});
