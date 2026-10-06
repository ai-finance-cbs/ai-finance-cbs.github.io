import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../assets/materials/demo.js';
const KEY = 'b8403-demo-state-v3';
let b;
beforeEach(async () => {
  const values = new Map();
  globalThis.sessionStorage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  globalThis.window = { location: new URL('http://127.0.0.1:4173/materials/?demo=1') };
  b = createDemo(); await b.pickRole('instructor'); await b.syncCanvas('spring-2027');
});
const write = (status = 'excused', excuse_reason = 'Approved absence') => b.saveAttendance(1, [{ uni: 'ab1234', status, excuse_reason }]);
const row = async () => (await b.classData()).attendance.find(a => a.uni === 'ab1234' && a.week === 1);

async function quiz(score) {
  const role=(await b.getAccess()).role;await b.pickRole('instructor');
  const d=JSON.parse(sessionStorage.getItem(KEY)),c=d.canvas['spring-2027'],m=c.mappings.find(m=>m.site_key==='Q1');
  Object.assign(c.submissions.find(s=>s.user_id==='1'&&s.assignment_id===m.canvas_assignment_id),{score});
  sessionStorage.setItem(KEY,JSON.stringify(d));await b.syncCanvas('spring-2027');await b.pickRole(role);
}
test('demo instructor excuse metadata, removal, zero-score precedence, and history match SQL', async () => {
  await write(); let a = await row(); assert.equal(a.status, 'excused'); assert.equal(a.excuse_reason, 'Approved absence');
  assert.equal(a.excused_by, 'oh@gsb.columbia.edu'); assert.ok(a.excused_at);
  await write(null); assert.equal(await row(), undefined);
  await write(); await quiz(null); assert.equal((await row()).status, 'excused');
  await b.pickRole('grader'); await quiz(0);
  a = await row(); assert.equal(a.status, 'present'); assert.equal(a.manual_override, false); assert.equal(a.excuse_reason, null);
  assert.ok(JSON.parse(sessionStorage.getItem(KEY)).attendance_audit.some(a => a.old_row?.excuse_reason === 'Approved absence' && a.new_row?.status === 'present'));
  await b.pickRole('instructor'); await assert.rejects(write(), /Present attendance/); await write(null); assert.equal((await row()).status, 'present');
  await quiz(null); assert.equal(await row(), undefined);
});
for (const role of ['grader', 'student', 'auditor', 'unlisted']) test(`demo ${role} cannot change attendance directly`, async () => {
  await write(); await b.pickRole(role);
  for (const status of ['excused', null, 'present', 'absent']) await assert.rejects(write(status), /Instructor/);
});
test('demo validates reasons and batches before persisting; preview is read-only', async () => {
  for (const reason of [null, '', ' \n\t', 1, 'x'.repeat(301)]) await assert.rejects(write('excused', reason), /reason/);
  for (const status of ['present', 'absent', 'late', '']) await assert.rejects(write(status), /Only excuse/);
  await assert.rejects(b.saveAttendance(99, []), /Invalid session/);
  await assert.rejects(b.saveAttendance(1, [{ uni: 'ab1234' }]), /Only excuse/);
  await assert.rejects(b.saveAttendance(1, [{ uni: 'ab1234', status: 'excused', excuse_reason: 'First' }, { uni: 'zz9999', status: null }]), /Unknown/);
  assert.equal(await row(), undefined);
  await write('excused', 'x'.repeat(300)); await b.setPreview('ab1234');
  await assert.rejects(write(), /read-only/); await assert.rejects(write(null), /read-only/);
  assert.equal(Object.hasOwn(await row(), 'excuse_reason'), false);
});
test('demo student release masking omits excuse metadata and keeps term history separate', async () => {
  await write(); await b.pickRole('student');
  assert.equal((await row()).status, 'excused'); assert.equal(Object.hasOwn(await row(), 'excuse_reason'), false);
  await b.pickRole('instructor'); await b.openTerm('Fall 2027'); const seed=JSON.parse(sessionStorage.getItem(KEY));seed.roster.push({term_id:'fall-2027',uni:'ab1234',name:'Alice'});sessionStorage.setItem(KEY,JSON.stringify(seed));
  await write('excused', 'New term'); await write(null);
  assert.equal((await b.classData('spring-2027')).attendance[0].excuse_reason, 'Approved absence');
  assert.equal((await b.classData()).attendance.length, 0);
});
test('demo removal restores a quiz-backed legacy excuse only without a Canvas quiz mapping', async () => {
  await b.saveCanvasMapping('spring-2027',{site_key:'Q1',kind:'quiz',week:1,canvas_assignment_id:null});
  await write(); const d = JSON.parse(sessionStorage.getItem(KEY));
  d.grades.push({ term_id: 'spring-2027', uni: 'ab1234', item_id: 7, score: 0 });
  sessionStorage.setItem(KEY, JSON.stringify(d)); await write(null); assert.equal((await row()).status, 'present');
  const legacy = JSON.parse(sessionStorage.getItem(KEY)); legacy.attendance[0].manual_override = true;
  sessionStorage.setItem(KEY, JSON.stringify(legacy)); await write(null); assert.equal((await row()).manual_override, true);
});
