import {test,expect} from '@playwright/test';
import {mkdirSync,readFileSync} from 'node:fs';
import {installArchiveFixture} from './archive-fixture.mjs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role='instructor',slug='gradebook')=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
test.beforeEach(async({page})=>{
  await installArchiveFixture(page);
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-24T10:00:00Z'));
  mkdirSync('evidence/canvas-d',{recursive:true});
});
for(const width of [1440,390,320])test(`compact staff pills, sticky names, roster badges and shared toggles at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:950});await enter(page);
  await page.evaluate(()=>{
    const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key)),c=d.canvas['spring-2027'];
    for(const [index,fields] of [
      [0,{workflow_state:'submitted',late:false,missing:false,excused:false}],
      [1,{workflow_state:'submitted',late:true,missing:false,excused:false}],
      [2,{workflow_state:'unsubmitted',late:false,missing:true,excused:false}],
      [3,{excused:true}],
      [4,{workflow_state:'unsubmitted',late:false,missing:false,excused:false,cached_due_at:'2099-01-01'}],
    ])Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===c.mappings[index].canvas_assignment_id),fields);
    c.enrollments.push({user_id:'98',uni:null,name:'Ambiguous Student',login_id:'duplicate',match_status:'ambiguous',enrollment_states:['active'],section_ids:['20']});
    sessionStorage.setItem(key,JSON.stringify(d));
  });
  await page.reload();await ready(page);
  const cells=page.locator('.canvas-grid tbody tr').first().locator('.canvas-status-cell');
  await expect(cells.locator('.canvas-status-pill').first()).toHaveText('✓');
  for(const [i,text,tone] of [[0,'✓','submitted'],[1,'Late','late'],[2,'Missing','missing'],[3,'EX','neutral'],[4,'–','neutral']]) {
    const pill=cells.nth(i).locator('.canvas-status-pill');await expect(pill).toHaveText(text);await expect(pill).toHaveClass(new RegExp(`status-${tone}`));
    await expect(cells.nth(i)).toHaveCSS('text-decoration-line','none');
  }
  await expect(page.locator('.canvas-grid thead th').nth(1)).toHaveAttribute('title','Milestone #1');
  const geometry=await page.locator('.canvas-grid').evaluate(table=>{
    const wrap=table.parentElement,name=table.querySelector('tbody th'),before=name.getBoundingClientRect().left;
    wrap.scrollLeft=200;return {before,after:name.getBoundingClientRect().left,width:table.querySelector('tbody td').getBoundingClientRect().width};
  });
  expect(geometry.after).toBe(geometry.before);expect(geometry.width).toBeGreaterThanOrEqual(60);expect(geometry.width).toBeLessThanOrEqual(70);
  await cells.first().click();await expect(page.getByRole('dialog',{name:'Canvas submission details'})).toBeVisible();await page.getByRole('button',{name:'Close details'}).click();
  await page.locator('.canvas-grid').evaluate(t=>t.parentElement.scrollLeft=0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/canvas-d/gradebook-${width}.png`,fullPage:true});
  await enter(page,'instructor','roster');
  await expect(page.locator('.roster-match-warning')).toHaveText(['ambiguous','unmatched']);
  await expect(page.locator('.roster-needs-match')).toHaveCount(2);
  await expect(page.locator('.roster-match:not(.roster-match-warning)').first()).toBeAttached();
  await expect(page.locator('.roster-match-warning').first()).toHaveCSS('color','rgb(133, 47, 74)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`evidence/canvas-d/roster-${width}.png`,fullPage:true});
  await enter(page,'instructor','settings');await expect(page.locator('#submission-settings,#roster-form,#grade-import')).toHaveCount(0);
  const toggle=page.locator('#canvas-settings > summary');
  for(const [open,symbol] of [[false,'+'],[true,'–']]) {
    if(open)await toggle.click();
    const style=await toggle.evaluate(n=>{const s=getComputedStyle(n,'::after');return {content:s.content,radius:s.borderRadius,width:s.width,height:s.height};});
    expect(style.content).toBe(`"${symbol}"`);expect(style.radius).toBe('50%');expect(style.width).toBe(style.height);
  }
});
test('archived groups, attendance, grades and file downloads survive retirement without editors',async({page})=>{
  await enter(page);
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    window.seedArchivedWork([{item_id:1,on_time_path:'archive/on-time.pdf'}]);
    await b.saveAttendance(1,[{uni:'ab1234',status:'excused',excuse_reason:'Archive fixture'}]);
    await b.openTerm('Spring 2028');
  });
  await page.reload();await ready(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');
  await expect(page.locator('.gradebook-grid')).toBeVisible();
  await page.locator('[data-grade-cell="ab1234:1"] button').click();
  const panel=page.locator('.grade-panel');await expect(panel.locator('input,textarea,form')).toHaveCount(0);
  await expect(panel.locator('[data-archived-score]')).toHaveText('Score: 8 / 10');
  for(const label of ['archive.pdf','Download last on-time file']) {
    const download=page.waitForEvent('download');await panel.getByRole('button',{name:label,exact:true}).click();
    expect(readFileSync(await (await download).path(),'utf8')).toContain('Synthetic');
  }
  await enter(page,'grader','groups');await page.locator('#archived-records > summary').click();
  await expect(page.locator('#archived-records')).toContainText('Week 2 lab');await expect(page.locator('#archived-records')).toContainText('Second Student');
  await expect(page.locator('#archived-records input,#archived-records button')).toHaveCount(0);
  await enter(page,'grader','attendance');await page.getByRole('button',{name:'Demo Student Week 1: excused',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Archive fixture');await expect(page.getByRole('button',{name:'Remove excuse'})).toHaveCount(0);
  await enter(page,'student','attendance');await expect(page.locator('.student-attendance-grid')).toContainText('Excused');
  await enter(page,'student','grades');await page.locator('#archived-records > summary').click();
  await expect(page.locator('#archived-records')).toContainText('8');await expect(page.locator('#archived-records')).not.toContainText('Second Student');
});
