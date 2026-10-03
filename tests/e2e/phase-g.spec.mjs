import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const ready=page=>expect(page.locator('html')).toHaveAttribute('data-materials-ready','true');
const enter=async(page,role,slug)=>{await page.goto(`/materials/${slug}/?fakeauth=${role}`);await ready(page);};
const panel=page=>page.locator('.grade-panel[data-profile-uni]');
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-02-03T14:15:00Z'));
  await page.setViewportSize({width:1440,height:1000});
  mkdirSync('evidence/phase-g',{recursive:true});
});
async function seed(page){
  await enter(page,'instructor','gradebook');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await b.saveGrades([{uni:'ab1234',item_id:1,score:null}]);
    await b.configureItem(1,{kind:'file',mode:'individual',due_at:'2027-02-03T14:00:00Z'});
    await b.configureItem(3,{kind:'file',mode:'individual',due_at:'2027-02-03T14:00:00Z'});
    await b.configureItem(6,{kind:'link',mode:'group',group_set_id:'demo-set',due_at:null});
    await b.chooseGroup('demo-set','demo-group-1','ab1234');
    await b.pickRole('student');
    await b.submitFile(1,new File(['%PDF-1.7\nSynthetic\n%%EOF'],'profile-demo.pdf',{type:'application/pdf'}));
    await b.submitFile(3,new File(['%PDF-1.7\nSynthetic\n%%EOF'],'late-demo.pdf',{type:'application/pdf'}));
    await b.submitLink(6,'https://example.test/prototype');
    await b.pickRole('instructor');
    await b.saveGrades([{uni:'ab1234',item_id:1,score:8,comment:'Visible feedback'},{uni:'ab1234',item_id:2,score:9,comment:'Private grading feedback'}]);
    await b.saveAttendance(1,[{uni:'ab1234',status:'present'}]);
    await b.saveAttendance(2,[{uni:'ab1234',status:'excused'}]);
    await b.saveAttendance(3,[{uni:'ab1234',status:'absent'}]);
  });
  await page.reload();await ready(page);
}
test('student card matches roster, attendance, submissions, scores and totals; note saves and keyboard moves',async({page})=>{
  await seed(page);await page.locator('[data-student-profile="ab1234"]').click();const card=panel(page);
  await expect(card.getByRole('heading',{name:'Demo Student',exact:true})).toBeVisible();
  await expect(card.getByRole('link',{name:'ab1234@columbia.edu'})).toBeVisible();await expect(card).toContainText('Week 2 lab: Group 1');
  await expect(card.locator('.profile-attendance li')).toHaveCount(6);await expect(card.getByLabel('Week 1: present',{exact:true})).toBeVisible();await expect(card.getByLabel('Week 2: excused',{exact:true})).toBeVisible();
  await card.locator('.profile-record > summary').click();
  await expect(card.locator('[data-profile-submission]')).toHaveCount(9);
  const m1=card.locator('[data-profile-submission="M1"]');await expect(m1).toContainText('Late');await expect(m1).toContainText('Feb 3');
  await expect(m1.getByRole('button',{name:'profile-demo.pdf'})).toBeVisible();
  const downloaded=page.waitForEvent('download');await m1.getByRole('button',{name:'profile-demo.pdf'}).click();expect((await downloaded).suggestedFilename()).toBe('profile-demo.pdf');
  await expect(card.getByRole('link',{name:'Open submitted link'})).toHaveAttribute('href','https://example.test/prototype');
  await expect(card.locator('[data-profile-score]')).toHaveCount(16);
  await expect(card.locator('[data-profile-score="M1"]')).toContainText('Visible');await expect(card.locator('[data-profile-score="M1"]')).toContainText('Visible feedback');
  await expect(card.locator('[data-profile-score="M2"]')).toContainText('Hidden');await expect(card.locator('[data-profile-score="M2"]')).toContainText('Private grading feedback');
  await expect(card.locator('[data-profile-visible-total]')).toHaveText('8');await expect(card.locator('[data-profile-all-total]')).toHaveText('17 incl. hidden');
  await card.locator('.profile-record > summary').click();await card.evaluate(n=>n.scrollTop=0);
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{document.activeElement.blur();window.scrollTo({top:0,behavior:'instant'});});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await page.screenshot({path:'evidence/phase-g/student-card.png',fullPage:true});
  await card.getByLabel('Private instructor note').fill('Synthetic private student note');await card.getByRole('button',{name:'Save note'}).click();await expect(card.locator('.profile-note [role=status]')).toContainText('Saved');
  await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('Escape');await expect(page.locator('.grade-panel')).toBeHidden();
  await page.locator('[data-student-profile="ab1234"]').click();
  await card.locator('h2').focus();await page.keyboard.press('ArrowDown');await expect(card.locator('h2')).toHaveText('Second Student');
  await page.keyboard.press('ArrowUp');await expect(card.locator('h2')).toHaveText('Demo Student');await expect(card.getByLabel('Private instructor note')).toHaveValue('Synthetic private student note');
  await page.keyboard.press('Escape');await expect(page.locator('.grade-panel')).toBeHidden();await expect(page.locator('[data-student-profile="ab1234"]')).toBeFocused();
  // Reusing the same panel for grading and profiles must not leave stale keyboard behavior.
  await page.locator('[data-grade-cell="ab1234:1"]').click();await expect(page.locator('.grade-panel')).toContainText('M1 · Demo Student');await expect(panel(page)).toHaveCount(0);
});
test('Attendance and Roster open cards; grader card has email but no private note',async({page})=>{
  await seed(page);
  for(const [role,slug] of [['instructor','attendance'],['instructor','roster'],['grader','attendance'],['grader','gradebook']]){
    await enter(page,role,slug);await page.locator('[data-student-profile="ab1234"]').click();
    await expect(panel(page).getByRole('link',{name:'ab1234@columbia.edu'})).toBeVisible();
    await expect(panel(page).getByLabel('Private instructor note')).toHaveCount(role==='instructor'?1:0);
  }
});
test('archived cards show saved notes read-only and preview has no cards',async({page})=>{
  await seed(page);await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.saveStudentNote('spring-2027','ab1234','Archived private note');await b.openTerm('Fall 2027');});
  await page.reload();await ready(page);await page.getByLabel('Term',{exact:true}).selectOption('spring-2027');
  await page.locator('[data-student-profile="ab1234"]').click();const note=panel(page).getByLabel('Private instructor note');await expect(note).toHaveValue('Archived private note');await expect(note).toBeDisabled();await expect(panel(page).getByRole('button',{name:'Save note'})).toBeDisabled();
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.setPreview('ab1234','spring-2027');});
  await page.goto('/materials/attendance/');await ready(page);await expect(page.locator('[data-student-profile]')).toHaveCount(0);await expect(page.getByLabel('Private instructor note')).toHaveCount(0);
});
test('Settings saves the student sign-up note and adds empty groups',async({page})=>{
  await enter(page,'instructor','settings');
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.setGroupNote('demo-set','');const key='b8403-demo-state-v3',data=JSON.parse(sessionStorage.getItem(key));data.sets[0].max_size=4;sessionStorage.setItem(key,JSON.stringify(data));});
  await page.reload();await ready(page);await page.locator('#group-settings > summary').click();
  const note='Up to 4 per group. Working alone? Join an empty group by yourself.';
  await page.getByLabel('Sign-up note',{exact:true}).fill(note);await page.getByRole('button',{name:'Save sign-up note',exact:true}).click();await expect(page.locator('#group-note-demo-set [role=status]')).toHaveText('Sign-up note saved.');
  await page.getByLabel('Number of groups to add').fill('3');await page.getByRole('button',{name:'Add groups',exact:true}).click();await expect(page.locator('#group-settings')).toContainText('5 groups');
  await enter(page,'student','groups');await expect(page.locator('.group-note')).toHaveText(note);await expect(page.locator('.group-grid tbody tr')).toHaveCount(5);await expect(page.locator('.group-grid tbody tr').last()).toContainText('No members yet.');
  await page.screenshot({path:'evidence/phase-g/groups-note.png',fullPage:true});
});
test('no calendar links appear on Course Goals or week pages (Simon removed them)',async({page})=>{
  await page.goto('/syllabus/');await expect(page.locator('.calendar-links,[data-calendar-links]')).toHaveCount(0);
  await page.goto('/materials/week-1/?fakeauth=student');await ready(page);await expect(page.locator('.calendar-links,[data-week-calendar]')).toHaveCount(0);
});

for(const width of [1280,390,320]) test(`design B fits at ${width}px with initials, stamps, chips and a scoped barcode`,async({page})=>{
  await page.setViewportSize({width,height:1000});await seed(page);
  await page.locator('[data-student-profile="ab1234"]').click();const card=panel(page);
  await expect(card.locator('.band')).toHaveText('B8403 · spring 2027Student');
  await expect(card.locator('.photo')).toHaveText('DS');await expect(card.locator('.barcode')).toHaveAttribute('aria-hidden','true');
  await expect(card.locator('.work-chips button')).toHaveCount(16);
  await expect(card.locator('[data-profile-chip=M1]')).toHaveText('M1 8/10');
  await expect(card.locator('[data-profile-chip=M2]')).toHaveText('M2 hidden');
  await expect(card.locator('[data-profile-chip=M3]')).toHaveText('M3 late');
  await expect(card.locator('[data-profile-chip=M4]')).toHaveText('M4 —');
  const shape=await card.evaluate(p=>{
    const node=s=>p.querySelector(s),css=s=>getComputedStyle(node(s)),photo=node('.photo').getBoundingClientRect();
    return {pageFits:document.documentElement.scrollWidth<=innerWidth,panelFits:p.scrollWidth<=p.clientWidth,
      photo:[photo.width,photo.height],serif:css('.name').fontFamily,band:css('.band').backgroundColor,
      present:css('.stamp.present').backgroundColor,absent:css('.stamp.absent').backgroundColor,
      unrecorded:css('.stamp.unrecorded').borderTopStyle,barcode:css('.barcode').backgroundImage,
      mainColumns:css('.main').gridTemplateColumns.split(' ').length,
    };
  });
  expect(shape.pageFits).toBe(true);expect(shape.panelFits).toBe(true);expect(shape.photo).toEqual([86,104]);
  expect(shape.serif).toContain('Source Serif 4');expect(shape.band).toBe('rgb(47, 111, 184)');
  expect(shape.present).toBe('rgb(47, 111, 184)');expect(shape.absent).toBe('rgb(243, 211, 215)');
  expect(shape.unrecorded).toBe('dashed');expect(shape.barcode).toContain('repeating-linear-gradient');
  expect(shape.mainColumns).toBe(width<480?1:2);
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{document.activeElement.blur();window.scrollTo({top:0,behavior:'instant'});});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await page.screenshot({path:`evidence/phase-g/student-card-${width}.png`,fullPage:true});
});

test('every work chip opens its grade panel and Attendance/Roster use the same grading controls',async({page})=>{
  await seed(page);
  const codes=await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();return (await b.classData()).items.map(i=>i.code);});
  for(const code of codes){
    await page.locator('[data-student-profile="ab1234"]').click();await panel(page).locator(`[data-profile-chip="${code}"]`).click();
    await expect(page.locator('#grade-panel-title')).toHaveText(`${code} · Demo Student`);
    await page.getByRole('button',{name:'Back to student card',exact:true}).click();await expect(panel(page).locator('.student-card')).toBeVisible();
  }
  for(const slug of ['attendance','roster']){
    await enter(page,'instructor',slug);await page.locator('[data-student-profile="ab1234"]').click();await panel(page).locator('[data-profile-chip=M2]').click();
    await expect(page.locator('#grade-panel-title')).toHaveText('M2 · Demo Student');
    await page.getByLabel('Score',{exact:true}).fill('7');await page.getByRole('button',{name:'Save student grade',exact:true}).click();
    await expect(panel(page).locator('.student-card')).toBeVisible();await expect(panel(page).locator('[data-profile-all-total]')).toHaveText('15 incl. hidden');
  }
});
