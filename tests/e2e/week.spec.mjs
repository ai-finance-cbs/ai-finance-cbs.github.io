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
async function seed(page, joined=true) {
  await enter(page,'instructor');
  await page.evaluate(async joined => {
    const b=(await import('/assets/materials/demo.js')).createDemo();
    for(let week=1;week<=6;week++) {
      const day=12+(week-1)*7;
      const start=new Date(Date.UTC(2027,0,day,14)); const end=new Date(Date.UTC(2027,0,day,17));
      await b.setSessionTimes(week,start.toISOString(),end.toISOString());
    }
    for(const id of [2,3,5,6]) await b.configureItem(id,{kind:id===6?'link':'file',mode:'group',group_set_id:'demo-set',due_at:'2027-01-26T14:00:00Z'});
    const key='b8403-demo-state-v3', d=JSON.parse(sessionStorage.getItem(key));
    // A fresh set closes at its earliest deadline. Use the fixture before that deadline.
    d.files=[{id:'handout',week:3,title:'Verification exercise',category:'in_class',storage_path:'demo/handout.pdf',released:false,release_at:null,auditor_visible:true},
      {id:'timed',week:3,title:'Scheduled exercise',category:'in_class',storage_path:'demo/timed.pdf',released:false,release_at:'2027-01-26T14:00:00Z',auditor_visible:true},
      {id:'private',week:3,title:'Private class notes',category:'notes',storage_path:'demo/private.pdf',released:true,auditor_visible:false}];
    d.announcements=[{id:'old',title:'Earlier notice',body:'Review the readings.',created_at:'2027-01-20T15:00:00Z'},
      {id:'new',title:'Class update',body:'Bring your annotated task map.',created_at:'2027-01-25T15:00:00Z'}];
    sessionStorage.setItem(key,JSON.stringify(d));
    if(joined) { await b.pickRole('student'); await b.chooseGroup('demo-set','demo-group-1'); }
  },joined);
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
    await page.goto(`/schedule/${slug}`); await ready(page); await expect(page).toHaveURL(new RegExp(`/syllabus/${slug}$`));
  }
  await page.goto('/materials/assignments/?fakeauth=student#milestone-3'); await ready(page);
  await expect(page).toHaveURL(/materials\/assignments\/milestone-3\/#milestone-3$/);
  await page.goto('/materials/lecture-notes/#week-2'); await ready(page); await expect(page).toHaveURL(/materials\/week-2\/#lecture-notes$/);
  await page.goto('/materials/upcoming/'); await ready(page); await expect(page).toHaveURL(/materials\/week-1\/$/);
});

test('no-group message, early grade lock, empty notes, and Auditor denial match the page contract', async ({page}) => {
  await seed(page,false); await enter(page,'student');
  await expect(page.locator('#milestone-3')).toContainText('Join a group');
  await expect(page.getByRole('link',{name:'Join a group',exact:true})).toHaveAttribute('href','/materials/groups/');
  await expect(page.getByLabel('Submission file')).toHaveCount(0);
  await enter(page,'student','week-1');
  await expect(page.locator('[data-submission-locked]')).toContainText('Graded, locked.');
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

test('file errors use one inline status; upload, late replace, and graded lock use backend state', async ({page}) => {
  const dialogs=[]; page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
  await seed(page); await enter(page,'student');
  const input=page.getByLabel('Submission file');
  await input.setInputFiles({name:'wrong.exe',mimeType:'application/octet-stream',buffer:Buffer.from('wrong')});
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
  await input.setInputFiles({name:'large.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(26*1024*1024)});
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
  await expect(page.locator('[data-submission-status]')).toHaveCount(1);
  await input.setInputFiles(pdf('working-setup.pdf')); await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Submitted · working-setup.pdf · Tue, Jan 26, 8:00 AM');
  await page.clock.setFixedTime(new Date('2027-01-26T14:02:00Z'));
  await input.setInputFiles(pdf('revised-setup.pdf')); await page.getByRole('button',{name:'Replace submission'}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Late · revised-setup.pdf · Tue, Jan 26, 9:02 AM');
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('grader');await b.gradeGroup(3,'demo-group-1',8,'Check the source.');await b.pickRole('student');});
  await page.reload(); await ready(page);
  await expect(page.locator('[data-submission-locked]')).toContainText('Late · revised-setup.pdf');
  await expect(input).toHaveCount(0); expect(dialogs).toEqual([]);
});

test('Final Prototype accepts only HTTPS links and replaces them in the same status slot', async ({page}) => {
  await seed(page); await enter(page,'student','week-6');
  await expect(page.getByLabel('Submission file')).toHaveCount(0);
  await page.getByLabel('Prototype HTTPS link').fill('http://example.com/video');
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toHaveText('Link must start with https://.');
  await page.getByLabel('Prototype HTTPS link').fill('https://example.com/video');
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toContainText('Submitted · https://example.com/video');
  await expect(page.getByRole('link',{name:'Open submission'})).toHaveAttribute('rel','noopener noreferrer');
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

test('preview shows the student submission and disables uploads; archived pages also disable uploads', async ({page}) => {
  await seed(page); await enter(page,'student');
  await page.getByLabel('Submission file').setInputFiles(pdf('student-work.pdf'));
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toContainText('student-work.pdf');
  const real=await page.locator('[data-submission-status]').textContent();
  await enter(page,'instructor'); await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');
  await expect(page.locator('[data-preview-banner]')).toBeVisible();
  await expect(page.getByLabel('Submission file')).toBeDisabled();
  await expect(page.getByRole('button',{name:'Replace submission'})).toBeDisabled();
  await expect(page.locator('[data-submission-status]')).toHaveText(real);
  await expect(page.getByRole('button',{name:'Release now'})).toHaveCount(0);
  await page.locator('[data-preview-exit]').click(); await enter(page,'student');
  await page.evaluate(()=>{const key='b8403-demo-state-v3',d=JSON.parse(sessionStorage.getItem(key));d.terms[0].status='archived-readable';sessionStorage.setItem(key,JSON.stringify(d));});
  await page.reload();await ready(page);await expect(page.getByLabel('Submission file')).toBeDisabled();
});

test('Grades orders all codes, keeps unreleased comments hidden, caps optional points, and Attendance has six sessions', async ({page}) => {
  await seed(page); await enter(page,'student');
  await page.clock.setFixedTime(new Date('2027-01-26T14:02:00Z'));
  await page.getByLabel('Submission file').setInputFiles(pdf('late.pdf')); await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toContainText('Late');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('instructor');
    await b.gradeGroup(3,'demo-group-1',9,'Hidden comment');
    await b.saveGrades([{uni:'ab1234',item_id:1,score:8,comment:'Released comment'}, {uni:'ab1234',item_id:13,score:10},{uni:'ab1234',item_id:14,score:10}]);
    await b.releaseItem(13,true);await b.releaseItem(14,true);await b.pickRole('student');
  });
  await page.goto('/materials/grades/'); await ready(page);
  await expect(page.locator('[data-grade-code=M3] .grade-status')).toHaveText('Late');
  await expect(page.locator('[data-grade-code=M3] .grade-score')).toHaveCount(0);
  await expect(page.locator('#materials-root')).not.toContainText('Hidden comment');
  await expect(page.locator('[data-grade-code=M1] .grade-comment')).toHaveText('Released comment');
  await expect(page.locator('[data-grade-total]')).toHaveText('Total23 / 100');
  await page.evaluate(async()=>{const b=(await import('/assets/materials/demo.js')).createDemo();await b.pickRole('instructor');await b.releaseItem(3,true);await b.pickRole('student');});
  await page.reload();await ready(page);
  await expect(page.locator('[data-grade-code=M3] .grade-status')).toHaveCount(0);
  await expect(page.locator('[data-grade-code=M3] .grade-score')).toHaveText('9 / 10');
  expect(await page.locator('[data-grade-code]').evaluateAll(rows=>rows.map(r=>r.dataset.gradeCode))).toEqual(['M1','M2','M3','M4','M5','FP','Q1','Q2','Q3','Q4','Q5','PA','O1','O2','O3','O4']);
  await page.goto('/materials/attendance/'); await ready(page);
  await expect(page.locator('.student-attendance-grid tbody tr')).toHaveCount(6);
  await expect(page.locator('#my-grades')).toHaveCount(0);
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
  await page.getByLabel('Submission file').setInputFiles(pdf('working-setup.pdf'));await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toContainText('Submitted · working-setup.pdf');await capture('week-3-student-after');
  await enter(page,'instructor');await capture('week-3-instructor');
  await enter(page,'student','grades');await capture('grades');
  await page.goto('/syllabus/week-1/');await ready(page);await capture('syllabus-week-1');
});

test('individual milestones upload without a group and keep the saved filename on reload', async ({page}) => {
  await enter(page,'student','week-4');
  await expect(page.locator('.submission-mode')).toHaveCount(0);
  await page.getByLabel('Submission file').setInputFiles(pdf('personal-benchmark.pdf'));
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect(page.locator('[data-submission-status]')).toContainText('Submitted · personal-benchmark.pdf');
  await page.reload(); await ready(page);
  await expect(page.locator('[data-submission-status]')).toContainText('Submitted · personal-benchmark.pdf');
});

test('each role gets its exact menu and Files stays reachable only by the instructor', async ({page}) => {
  const publicMenu=['Home','Syllabus','Library','Staff','Nota Bene'];
  for(const [role,extra] of Object.entries({student:['Course Materials','Assignments','Attendance','Grades','Groups','Submit'],auditor:['Course Materials','Assignments'],grader:['Course Materials','Assignments'],instructor:['Course Materials','Assignments','Groups']})) {
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

test('Grades reserves status for upload items without a released score, including zero scores',async({page})=>{
  await enter(page,'instructor','grades');
  await page.evaluate(async()=>{
    const b=(await import('/assets/materials/demo.js')).createDemo();
    await b.saveGrades([{uni:'ab1234',item_id:1,score:0},{uni:'ab1234',item_id:7,score:0},{uni:'ab1234',item_id:12,score:6},{uni:'ab1234',item_id:16,score:3}]);
    for(const id of [1,7,8,12,16]) await b.releaseItem(id,true);
  });
  await enter(page,'student','grades');
  for(const [code,score] of [['M1','0 / 10'],['Q1','0 / 3'],['PA','6 / 10'],['O4','3 / 5']]) {
    await expect(page.locator(`[data-grade-code=${code}] .grade-score`)).toHaveText(score);
    await expect(page.locator(`[data-grade-code=${code}] .grade-status`)).toHaveCount(0);
  }
  for(const code of ['Q2','Q3','Q4','Q5']) {
    await expect(page.locator(`[data-grade-code=${code}] p`)).toHaveCount(0);
  }
  for(const code of ['M4','FP','O1']) await expect(page.locator(`[data-grade-code=${code}] .grade-status`)).toHaveText('Not submitted');
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

for(const width of [1440,390,320]) test(`section labels and compact file/link controls at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await seed(page);await enter(page,'student');
  await expect(page.locator('#materials-root > .week-block > h2')).toHaveText(['Announcements','Due before class','Lecture notes & materials','Full reading list']);
  const styles=await page.locator('#materials-root > .week-block > h2').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return [s.fontSize,s.fontWeight,s.letterSpacing,s.textTransform,s.color];}));
  expect(styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0]))).toBe(true);
  expect(styles[0].slice(0,4)).toEqual(['12px','600','0.48px','uppercase']);
  expect(await page.locator('#milestone-3 h3').evaluate(n=>getComputedStyle(n).fontSize)).toBe('15px');
  await expect(page.getByLabel('Submission file')).toBeHidden();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose file',exact:true}).click();
  const name='a-long-selected-name-that-must-not-push-submit-off-the-phone.pdf';await (await chooser).setFiles(pdf(name));
  await expect(page.locator('[data-selected-file]')).toHaveText(name);
  const geometry=async()=>page.locator('form.submission-box').evaluate(form=>{
    const row=form.querySelector('.submission-row'),children=[...row.children].filter(n=>!n.hidden),status=form.querySelector('.submission-status'),hint=form.querySelector('.submission-hint');
    const rect=n=>n.getBoundingClientRect();
    return {border:getComputedStyle(form).borderWidth,centers:children.map(n=>rect(n).top+rect(n).height/2),rowBottom:rect(row).bottom,statusTop:rect(status).top,statusBottom:rect(status).bottom,hintTop:rect(hint).top,hintSize:getComputedStyle(hint).fontSize};
  });
  for(const slug of ['week-3','week-6']) {
    if(slug==='week-6') {await page.goto('/materials/week-6/');await ready(page);}
    const g=await geometry();expect(g.border).toBe('0px');expect(Math.max(...g.centers)-Math.min(...g.centers)).toBeLessThan(1);
    expect(g.statusTop).toBeGreaterThanOrEqual(g.rowBottom);expect(g.hintTop).toBeGreaterThanOrEqual(g.statusBottom);expect(g.hintSize).toBe('12px');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await enter(page,'instructor');await page.getByLabel('View as student',{exact:true}).selectOption('ab1234');
  await expect(page.getByRole('button',{name:'Choose file',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeDisabled();
});
