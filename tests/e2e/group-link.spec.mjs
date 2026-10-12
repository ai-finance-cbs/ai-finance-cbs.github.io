import {test,expect} from '@playwright/test';
const url='/materials/assignments/milestone-3/',term='spring-2027';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const form=page=>page.locator('#submission-M3 .group-link-editor');
const status=page=>page.locator('#submission-M3 > .assignment-panel-head .group-link-status');
const enter=async(page,role='student')=>{await page.goto(`${url}?fakeauth=${role}`);await ready(page);};
async function member(page,uni){await page.evaluate(uni=>sessionStorage.setItem('b8403-demo-user-v1',JSON.stringify({email:`${uni}@columbia.edu`,uni})),uni);await page.goto(url);await ready(page);}
async function submit(page,link='https://sample-team.github.io/'){
  await form(page).getByLabel('Live website link',{exact:true}).fill(link);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page)).toContainText('Saved!');
}
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-24T14:00:00Z'));
  await enter(page,'instructor');
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k)),c=d.canvas['spring-2027'];
    c.groups.push({id:'11',category_id:'1',category_name:'Prototype',name:'Other group'});c.group_members.push({group_id:'11',user_id:'3',name:'Third Student'});sessionStorage.setItem(k,JSON.stringify(d));});
  await enter(page);
});
test('member A submits, member B replaces, member C sees no link, and staff see one Missing group',async({page})=>{
  await expect(form(page)).toContainText('Demo group · Demo Student, Second Student');await expect(form(page)).toContainText('Your group has not submitted yet.');
  await expect(status(page)).toHaveClass(/task-map-status in-panel-head/);await expect(form(page).locator('.group-link-status')).toHaveCount(0);
  await submit(page);await expect(form(page)).toContainText('Submitted by Demo Student, Jan 24, 2027, 9:00 AM ET');
  await member(page,'cd5678');await expect(form(page).getByLabel('Live website link')).toHaveValue('https://sample-team.github.io/');
  await submit(page,'https://custom-project.example.test/');await expect(form(page)).toContainText('Submitted by Second Student');
  await member(page,'ab1234');await expect(form(page).getByRole('link',{name:'https://custom-project.example.test/'})).toHaveAttribute('href','https://custom-project.example.test/');
  await member(page,'ef9012');await expect(form(page)).toContainText('Your group has not submitted yet.');await expect(form(page)).not.toContainText('custom-project');
  for(const role of ['instructor','grader']){await enter(page,role);await expect(page.locator('.group-link-counts')).toHaveText('1 of 2 groups submitted');
    const rows=page.locator('.group-link-table tbody tr');await expect(rows).toHaveCount(2);await expect(rows.nth(0)).toContainText('Second Student');await expect(rows.nth(0)).toContainText('On time');await expect(rows.nth(1)).toContainText('Missing');await expect(page.locator('#submission-M3 input')).toHaveCount(0);}
});
test('explicit submission accepts custom domains, rejects invalid links, and never saves a half-typed URL',async({page})=>{
  const input=form(page).getByLabel('Live website link');await input.fill('https://custom.example.test/');await expect(form(page).locator('.group-link-hint')).toContainText('custom domain is fine');
  expect(await page.evaluate(async()=> (await(await import('/assets/materials/demo.js')).createDemo().myGroupLink('spring-2027','M3')).submission)).toBe(null);
  await input.fill('http://example.test');await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.group-link-message')).toContainText('https://');
  await submit(page,'https://custom.example.test/');await page.reload();await ready(page);await expect(input).toHaveValue('https://custom.example.test/');
});
test('Saving and Saved statuses follow the response; failed saves retain the typed replacement',async({page})=>{
  await page.route('**/assets/materials/group-link-demo.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('async saveGroupLink(term,code,link) {',
    'async saveGroupLink(term,code,link) { if(window.failGroupLink)throw Error("Synthetic save failure."); if(window.delayGroupLink)await new Promise(resolve=>window.releaseGroupLink=resolve);')});});
  await page.reload();await ready(page);await page.evaluate(()=>window.delayGroupLink=true);
  await form(page).getByLabel('Live website link').fill('https://first.test');await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page)).toContainText('Saving…');await expect(form(page).getByLabel('Live website link')).toBeDisabled();
  await page.evaluate(()=>{window.delayGroupLink=false;window.releaseGroupLink();});await expect(status(page)).toContainText('Saved!');
  await page.evaluate(()=>window.failGroupLink=true);await form(page).getByLabel('Live website link').fill('https://replacement.test');await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(form(page).locator('.group-link-message')).toHaveText('Synthetic save failure.');
  await expect(form(page).getByLabel('Live website link')).toHaveValue('https://replacement.test');await expect(form(page).getByRole('link')).toHaveAttribute('href','https://first.test');
  await page.evaluate(()=>window.failGroupLink=false);await form(page).getByRole('button',{name:'Submit',exact:true}).click();await expect(status(page)).toContainText('Saved!');
});
test('deadline uses the Canvas individual date, locks the form, and preserves the final clickable link',async({page})=>{
  await submit(page);
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k)),c=d.canvas['spring-2027'],m=c.mappings.find(m=>m.site_key==='M3');
    d.items.find(i=>i.code==='M3').due_at='2099-01-01';c.assignments.find(a=>a.id===m.canvas_assignment_id).due_at='2099-01-01';c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===m.canvas_assignment_id).cached_due_at='2027-01-24T14:00:00Z';sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(form(page).getByLabel('Live website link')).toBeDisabled();await expect(form(page).getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);await expect(form(page).locator('.group-link-warning')).toContainText('Submissions closed Jan 24');
  await expect(page.locator('.assignment-page > .due-line')).toContainText('Jan 24');await expect(form(page).getByRole('link')).toHaveAttribute('href','https://sample-team.github.io/');
  expect(await page.evaluate(async()=>{try{await(await import('/assets/materials/demo.js')).createDemo().saveGroupLink('spring-2027','M3','https://late.test');return false;}catch{return true;}})).toBe(true);
});
for(const missing of ['mapping','category','group','deadline'])test(`missing ${missing} fails closed with a useful message`,async({page})=>{
  await page.evaluate(missing=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k)),c=d.canvas['spring-2027'],m=c.mappings.find(m=>m.site_key==='M3');
    if(missing==='mapping')c.mappings=c.mappings.filter(m=>m.site_key!=='M3');
    if(missing==='category')c.assignments.find(a=>a.id===m.canvas_assignment_id).group_category_id=null;
    if(missing==='group')c.group_members=c.group_members.filter(m=>m.user_id!=='1');
    if(missing==='deadline')c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===m.canvas_assignment_id).cached_due_at=null;
    sessionStorage.setItem(k,JSON.stringify(d));},missing);await page.reload();await ready(page);
  const panel=page.locator('#submission-M3');await expect(panel).toContainText(missing==='group'?'Join your group on Canvas first. The site updates after the next Canvas sync.':missing==='deadline'?'Canvas M3 deadline unavailable.':'Group submission is not set up yet. Email the teaching team.');
  if(missing==='deadline'){await expect(form(page).getByLabel('Live website link')).toBeDisabled();await expect(page.locator('.assignment-page > .due-line')).toHaveText('No due date');}
  else await expect(panel.locator('input')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Submit',exact:true})).toHaveCount(0);
});
test('preview shows the selected group read-only and rejects direct writes and class data',async({page})=>{
  await submit(page);await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await expect(form(page).getByLabel('Live website link')).toBeDisabled();await expect(form(page)).toContainText('Read-only view');
  expect(await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const fn of [()=>b.saveGroupLink('spring-2027','M3','https://bad.test'),()=>b.groupLinkClass('spring-2027','M3')])try{await fn();}catch{denied++;}return denied;})).toBe(2);
  await page.getByRole('button',{name:'Exit',exact:true}).click();await expect(page.locator('.group-link-counts')).toBeVisible();
  await page.getByLabel('View as student',{exact:true}).selectOption('ef9012');await expect(form(page)).toContainText('Your group has not submitted yet.');
});
for(const role of ['auditor','unlisted'])test(`${role} has no form or submission reads`,async({page})=>{
  await enter(page,role);await expect(page.locator('#submission-M3')).toHaveCount(0);
  expect(await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();let denied=0;for(const fn of [()=>b.myGroupLink('spring-2027','M3'),()=>b.saveGroupLink('spring-2027','M3','https://bad.test'),()=>b.groupLinkClass('spring-2027','M3')])try{await fn();}catch{denied++;}return denied;})).toBe(3);
});
test('a group move does not carry the submission and an unsaved replacement warns before sign-out',async({page})=>{
  await submit(page);await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.canvas['spring-2027'].group_members.find(m=>m.user_id==='1').group_id='11';sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(form(page)).toContainText('Other group');await expect(form(page)).toContainText('Your group has not submitted yet.');
  await member(page,'cd5678');await expect(form(page).getByRole('link')).toHaveAttribute('href','https://sample-team.github.io/');
  await form(page).getByLabel('Live website link').fill('https://unsaved.test');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Unsaved changes');await page.getByRole('button',{name:'Keep editing'}).click();await expect(form(page).getByLabel('Live website link')).toHaveValue('https://unsaved.test');
});
for(const width of [1280,390,320])test(`student and staff group submissions fit ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await submit(page,'https://custom.example.test/'+ 'long-path-'.repeat(12));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/group-link/student-${width}.png`,fullPage:true});await enter(page,'instructor');await expect(page.locator('.group-link-counts')).toContainText('1 of 2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/group-link/staff-${width}.png`,fullPage:true});
});
