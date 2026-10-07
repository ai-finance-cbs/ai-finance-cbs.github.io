import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
// Readiness waits on the demo backend; 15 s absorbs a busy machine without hiding a page that never loads.
const ready = page => expect(page.locator('html')).toHaveAttribute('data-materials-ready','true',{timeout:15000});
const enter = async (page, role, slug='week-3') => { await page.goto(`/materials/${slug}/?fakeauth=${role}`); await ready(page); };
const pdf = name => ({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nDemo submission\n%%EOF')});
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(window,'COURSE_MATERIALS',{get:()=>({base:'',url:'',key:''}),set:()=>{}}));
  await page.clock.setFixedTime(new Date('2027-01-26T13:00:00Z'));
});
async function seed(page) {
  await enter(page,'instructor');
  await page.evaluate(async () => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for(let week=1;week<=6;week++) {
      const day=12+(week-1)*7;
      const start=new Date(Date.UTC(2027,0,day,14)); const end=new Date(Date.UTC(2027,0,day,17));
      await b.setSessionTimes(week,start.toISOString(),end.toISOString());
    }
    const key='b8403-demo-state-v3', d=JSON.parse(sessionStorage.getItem(key));
    // A fresh set closes at its earliest deadline. Use the fixture before that deadline.
    d.files=[{id:'handout',week:3,title:'Verification exercise',category:'in_class',storage_path:'demo/handout.pdf',released:false,release_at:null,auditor_visible:true},
      {id:'timed',week:3,title:'Scheduled exercise',category:'in_class',storage_path:'demo/timed.pdf',released:false,release_at:'2027-01-26T14:00:00Z',auditor_visible:true},
      {id:'private',week:3,title:'Private class notes',category:'notes',storage_path:'demo/private.pdf',released:true,auditor_visible:false}];
    d.announcements=[{id:'old',title:'Earlier notice',body:'Review the readings.',created_at:'2027-01-20T15:00:00Z'},
      {id:'new',title:'Class update',body:'Bring your annotated task map.',created_at:'2027-01-25T15:00:00Z'}];
    sessionStorage.setItem(key,JSON.stringify(d));
    await b.syncCanvas('spring-2027');
  });
}

test('signed-in Home and Materials land on the first unfinished class, then Week 6; signed-out Home stays public', async ({page}) => {
  await page.goto('/'); await ready(page); await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading',{level:1})).not.toHaveText('AI Economics');
  await enter(page,'student',''); await expect(page).toHaveURL(/materials\/week-1\/$/);
  await seed(page); await page.goto('/'); await ready(page); await expect(page).toHaveURL(/materials\/week-3\/$/);
  await page.clock.setFixedTime(new Date('2027-01-26T17:00:00Z'));
  await page.goto('/materials/'); await ready(page); await expect(page).toHaveURL(/materials\/week-4\/$/);
  await page.clock.setFixedTime(new Date('2027-03-01T12:00:00Z'));
  await page.goto('/'); await ready(page); await expect(page).toHaveURL(/materials\/week-6\/$/);
});

test('all old URLs redirect, retaining assignment anchors, notes, and query parameters', async ({page}) => {
  for(const slug of ['',...Array.from({length:6},(_,i)=>`week-${i+1}/`)]) {
    await page.goto(`/schedule/${slug}`); await ready(page); await expect(page).toHaveURL(new RegExp(slug?`/syllabus/tentative-schedule/#${slug.slice(0,-1)}$`:'/syllabus/$'));
  }
  await page.goto('/materials/assignments/?fakeauth=student#milestone-3'); await ready(page);
  await expect(page).toHaveURL(/materials\/assignments\/milestone-3\/#milestone-3$/);
  await page.goto('/materials/lecture-notes/#week-2'); await ready(page); await expect(page).toHaveURL(/materials\/week-2\/#lecture-notes$/);
  await page.goto('/materials/upcoming/'); await ready(page); await expect(page).toHaveURL(/materials\/week-1\/$/);
});

test('Canvas status replaces local group prompts and locks; Auditor gates remain', async ({page}) => {
  await seed(page,false); await enter(page,'student');
  await expect(page.locator('#milestone-3')).toContainText('Submitted ✓');
  await expect(page.getByRole('link',{name:'Submit on CourseWorks →'})).toBeVisible();
  await expect(page.getByLabel('Submission file')).toHaveCount(0);
  await enter(page,'student','week-1');
  await expect(page.locator('[data-submission-status]')).toHaveText('Submitted ✓');
  await expect(page.locator('#lecture-notes')).toContainText('Posted after class.');
  await enter(page,'auditor');
  await expect(page.locator('.assignment-section')).toHaveCount(0);
  await expect(page.locator('#materials-root')).not.toContainText('Private class notes');
  await expect(page.locator('#week-announcements h3')).toHaveText(['Class update','Earlier notice']);
  for(const slug of ['grades','attendance']) {
    await page.goto(`/materials/${slug}/`); await ready(page);
    await expect(page.locator('#materials-root')).toContainText('does not have access');
    await expect(page.locator('.student-grade, .student-attendance-grid')).toHaveCount(0);
  }
});

test('release now and timed release expose in-class files to students with no release control', async ({page}) => {
  await seed(page); await enter(page,'student');
  await expect(page.locator('#in-class-files a')).toHaveCount(0);
  await enter(page,'instructor');
  const handout=page.locator('#in-class-files li').filter({hasText:'Verification exercise'});
  await handout.getByRole('button',{name:'Release now'}).click();
  await expect(handout.getByRole('button')).toHaveCount(0);
  await enter(page,'student');
  await expect(page.getByRole('link',{name:'Verification exercise',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Release now'})).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2027-01-26T14:01:00Z')); await page.reload(); await ready(page);
  await expect(page.getByRole('link',{name:'Scheduled exercise',exact:true})).toBeVisible();
});

test('preview shows the same Canvas status and archives have no upload controls', async ({page}) => {
  await seed(page); await enter(page,'student');
  const real=await page.locator('[data-submission-status]').textContent();
  await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await ready(page);
  await expect(page.locator('[data-submission-status]')).toHaveText(real);
  await expect(page.getByLabel('Submission file')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Release now'})).toHaveCount(0);
  await page.locator('[data-preview-exit]').click();await enter(page,'student');
  await page.evaluate(()=>{const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.terms[0].status='archived-readable';sessionStorage.setItem(key,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(page.getByLabel('Submission file')).toHaveCount(0);
});

for(const width of [1440,390]) test(`Phase B pages fit and screenshots capture required states at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000}); await seed(page);
  mkdirSync('evidence/phase-b/round-1',{recursive:true});
  const capture=async name=>{
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`evidence/phase-b/round-1/${name}-${width}.png`,fullPage:true});
  };
  await enter(page,'student');
  expect(await page.locator('#materials-root > *').evaluateAll(nodes=>nodes.map(n=>n.id||n.className))).toEqual(['week-announcements','due-before-class','lecture-notes','required-readings']);
  await capture('week-3-student-before');
  await enter(page,'instructor');await capture('week-3-instructor');
  await enter(page,'student','grades');await capture('grades');
  await page.goto('/syllabus/tentative-schedule/');await ready(page);await capture('syllabus-week-1');
});

test('each role gets its exact menu and Files stays reachable only by the instructor', async ({page}) => {
  const publicMenu=['Home','Syllabus','Library','Staff','Nota Bene'];
  for(const [role,extra] of Object.entries({student:['Course Materials','Assignments','Attendance','Grades','Groups'],auditor:['Course Materials','Assignments'],grader:['Course Materials','Assignments','Groups'],instructor:['Course Materials','Assignments','Groups']})) {
    const tools={student:[],auditor:[],grader:['Gradebook','Attendance'],instructor:['Gradebook','Attendance','Roster','Settings','Preparation','Speakers']}[role];
    await enter(page,role);
    await expect(page.locator('.topnav a:visible')).toHaveText([...publicMenu,...extra]);
    await expect(page.locator('.staff-menu')).toBeVisible({visible:tools.length>0});
    if(tools.length) await expect(page.locator('.staff-menu li:not([hidden]) a')).toHaveText(tools);
    await expect(page.locator('.topnav a[href="/materials/files/"]')).toHaveCount(0);
    await page.goto('/materials/files/'); await ready(page);
    await expect(page.locator('#file-form')).toHaveCount(role==='instructor'?1:0);
  }
});

test('only the newest notice is open; earlier notices use one collapsed disclosure',async({page})=>{
  await seed(page); await enter(page,'student');
  const notices=page.locator('#week-announcements');
  await expect(notices.locator('h3:visible')).toHaveText(['Class update']);
  await expect(notices.locator('details')).toHaveCount(1);
  await expect(notices.locator('details')).not.toHaveAttribute('open','');
  await expect(notices.locator('summary')).toHaveText('Earlier notices (1)');
  await notices.locator('summary').click();
  await expect(notices.locator('h3:visible')).toHaveText(['Class update','Earlier notice']);
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.announcements=d.announcements.filter(a=>a.id==='new');sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(notices.locator('details')).toHaveCount(0);
  await page.evaluate(()=>{const k='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(k));d.announcements=[];sessionStorage.setItem(k,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(notices).toHaveCount(0);
  await expect(page.locator('#materials-root')).not.toContainText('No announcements');
});

test('Files uploads use the category select, preserving titles and grouping by metadata',async({page})=>{
  await enter(page,'instructor','settings');
  await page.locator('#lecture-pdfs > summary').click();
  await expect(page.getByLabel('File category').locator('option')).toHaveText(['Lecture notes','In-class files']);
  for(const [category,title] of [['notes','In-class: a note title'],['in_class','Class handout']]) {
    await page.getByLabel('File category').selectOption(category);
    if (category === 'in_class') await page.getByLabel('Released now',{exact:true}).check();
    await page.getByLabel('File title',{exact:true}).fill(title);
    await page.getByLabel('Lecture PDF (maximum 20 MB)').setInputFiles(pdf('class.pdf'));
    await page.getByRole('button',{name:'Upload PDF',exact:true}).click();
    await expect(page.locator('[data-admin-status]')).toHaveText('PDF uploaded.');
    await expect(page.getByRole('link',{name:title,exact:true})).toBeVisible();
  }
  await enter(page,'student','week-1');
  await expect(page.locator('#lecture-note-files a')).toHaveText(['In-class: a note title']);
  await expect(page.locator('#in-class-files a')).toHaveText(['Class handout']);
});

for(const width of [1440,390,320]) test(`section labels and compact CourseWorks links at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await seed(page);await enter(page,'student');
  await expect(page.locator('#materials-root > .week-block > h2')).toHaveText(['Announcements','Due before class','Lecture notes & materials','Full reading list']);
  const styles=await page.locator('#materials-root > .week-block > h2').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return [s.fontSize,s.fontWeight,s.letterSpacing,s.textTransform,s.color];}));
  expect(styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0]))).toBe(true);
  expect(styles[0].slice(0,4)).toEqual(['12px','600','0.48px','uppercase']);
  expect(await page.locator('#milestone-3 h3').evaluate(n=>getComputedStyle(n).fontSize)).toBe('13px');
  for(const slug of ['week-3','week-6']) {
    await page.goto(`/materials/${slug}/`);await ready(page);
    await expect(page.getByRole('link',{name:'Submit on CourseWorks →'})).toBeVisible();
    await expect(page.locator('.submission-box,input[type=file]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');await ready(page);
  await expect(page.getByRole('button',{name:'Choose file',exact:true})).toHaveCount(0);
});
