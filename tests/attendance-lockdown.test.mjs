// Historical 017 behavior. Canvas cutover permissions and attendance are covered by canvas-staff-database.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { phaseDatabase, TERM } from './helpers/phase-a.mjs';
import { bootstrapSQL, migrationFiles } from './helpers/database.mjs';
let h;
before(async () => { h = await phaseDatabase(undefined,'019_canvas_student_views.sql'); });
after(async () => h?.db.close());
beforeEach(async () => { await h.as('owner'); await h.db.exec('begin'); });
afterEach(async () => { await h.db.exec('rollback; reset role'); });
const write = (status = 'excused', excuse_reason = 'Approved absence', uni = 'aa1001', week = 1) =>
  h.rpc('save_attendance', week, JSON.stringify([{ uni, status, excuse_reason }]));
const record = async (week = 1) => (await h.rpc('class_data')).attendance.find(a => a.uni === 'aa1001' && a.week === week);
async function denied(task, pattern) {
  await h.db.exec('savepoint denial');
  try { await assert.rejects(task, pattern); }
  finally { await h.db.exec('rollback to denial; release savepoint denial'); }
}

test('instructor excuses and removes; audit stores actor, reason, and old values', async () => {
  await h.as('teacher'); await write('excused', '  Approved absence  ');
  const a = await record();
  assert.equal(a.status, 'excused'); assert.equal(a.excuse_reason, 'Approved absence');
  assert.ok(a.excused_at); assert.equal(a.excused_by, 'oh@gsb.columbia.edu');
  await write(null); assert.equal(await record(), undefined);
  const audit = await h.rows("select * from audit_log where table_name='attendance' order by id");
  assert.equal(audit.length, 2); assert.equal(audit[0].new_row.excuse_reason, 'Approved absence');
  assert.equal(audit[1].old_row.excuse_reason, 'Approved absence'); assert.equal(audit[1].operation, 'DELETE');
});

for (const role of ['grader', 'a', 'auditor', 'outside', 'anon']) test(`${role} cannot excuse, remove, import, or write directly`, async () => {
  await h.as('teacher'); await write(); await h.as(role);
  for (const status of ['excused', null, 'present', 'absent']) await denied(() => write(status), /Instructor|permission denied/);
  await denied(() => h.rpc('save_attendance', 1, '[]'), /Instructor|permission denied/);
  for (const sql of ["insert into attendance(uni,week,status) values('bb1002',1,'present')", "update attendance set status='present'", 'delete from attendance'])
    await denied(() => h.rows(sql), /permission denied/);
});

test('reason is required, bounded, textual; arbitrary statuses and malformed entries are denied atomically', async () => {
  await h.as('teacher');
  for (const reason of [null, '', '   ', '\n\t', 42, 'x'.repeat(301)]) await denied(() => write('excused', reason), /reason/);
  for (const status of ['present', 'absent', '', 'late']) await denied(() => write(status), /Only excuse/);
  for (const entries of [null, '{}', '[null]', '[{"uni":"aa1001"}]'])
    await denied(() => h.rpc('save_attendance', 1, entries), /Invalid|Only excuse/);
  await denied(() => write('excused', 'Approved', 'zz9999'), /Unknown UNI/);
  await denied(() => write('excused', 'Approved', 'aa1001', 99), /Invalid session/);
  await denied(() => h.rpc('save_attendance', 1, JSON.stringify([
    { uni: 'aa1001', status: 'excused', excuse_reason: 'First' }, { uni: 'bb1002', status: 'present' },
  ])), /Only excuse/);
  assert.equal(await record(), undefined);
  await write('excused', 'x'.repeat(300)); assert.equal((await record()).excuse_reason.length, 300);
  await denied(() => h.rows("update attendance set status='present'"), /permission denied/);
});

test('zero quiz score overrides an excuse, keeps history, and clearing the score removes presence', async () => {
  await h.as('teacher'); await write(); await h.as('grader');
  await h.rpc('save_grades', '[{"uni":"aa1001","item_id":7,"score":0}]');
  const a = await record();
  assert.equal(a.status, 'present'); assert.equal(a.source_quiz, 1); assert.equal(a.manual_override, false);
  for (const key of ['excuse_reason', 'excused_at', 'excused_by']) assert.equal(a[key], null);
  await h.as('teacher');
  const audit = await h.rows("select old_row,new_row,actor_email from audit_log where table_name='attendance' and operation='UPDATE'");
  assert.equal(audit.at(-1).old_row.excuse_reason, 'Approved absence');
  assert.equal(audit.at(-1).new_row.status, 'present'); assert.equal(audit.at(-1).actor_email, 'grader@columbia.edu');
  await denied(() => write(), /Present attendance/);
  await write(null); assert.equal((await record()).status, 'present');
  await h.as('grader'); await h.rpc('save_grades', '[{"uni":"aa1001","item_id":7,"score":null}]');
  assert.equal(await record(), undefined);
});

test('clearing an unrecorded quiz keeps its excuse; removal uses the current quiz state', async () => {
  await h.as('teacher'); await write();
  await h.rpc('save_grades', '[{"uni":"aa1001","item_id":7,"score":null}]');
  assert.equal((await record()).status, 'excused');
  // Model an existing excuse plus a score. Removal must look up grades, not trust source_quiz.
  await h.as('owner'); await h.rows("insert into grades(uni,item_id,score) values('aa1001',7,0)");
  await h.as('teacher'); await write(null);
  assert.equal((await record()).status, 'present'); assert.equal((await record()).source_quiz, 1);
});

test('student and preview projections omit reasons and staff metadata; grader can read the reason', async () => {
  await h.as('teacher'); await write(); await h.as('grader'); assert.equal((await record()).excuse_reason, 'Approved absence');
  await h.as('a'); const student = await record(); assert.equal(student.status, 'excused');
  for (const key of ['excuse_reason', 'excused_at', 'excused_by']) assert.equal(Object.hasOwn(student, key), false);
  assert.deepEqual(await h.rows('select * from attendance'), []);
  await h.as('teacher'); await h.rpc('set_student_preview', 'aa1001');
  assert.deepEqual(await record(), student);
  for (const status of ['excused', null]) await denied(() => write(status), /preview.*read-only/i);
  await h.db.exec('reset role');
  for (const sql of ["update attendance set excuse_reason='Forbidden'", 'delete from attendance', "insert into attendance(uni,week,status) values('bb1002',1,'excused')"])
    await denied(() => h.rows(sql), /preview.*read-only/i);
});

test('excuse writes and quiz synchronization stay in the active term', async () => {
  await h.as('teacher'); await write('excused', 'Old term'); await h.rpc('open_term', 'Fall 2027');
  await denied(() => write(), /Unknown UNI/);
  await h.rpc('replace_roster', '[{"uni":"aa1001","name":"Alice"}]'); await write('excused', 'New term');
  const quiz = (await h.rpc('class_data')).items.find(i => i.quiz_week === 1);
  await h.as('grader'); await h.rpc('save_grades', JSON.stringify([{ uni: 'aa1001', item_id: quiz.id, score: 0 }]));
  assert.equal((await record()).status, 'present');
  const old = (await h.rpc('class_data', TERM)).attendance[0]; assert.equal(old.excuse_reason, 'Old term');
  await h.as('teacher'); await write(null); assert.equal((await record()).status, 'present');
  await h.rpc('set_student_preview', 'aa1001', TERM); await denied(() => write(null), /read-only/);
});

test('migration preserves legacy overrides and retains guards, audit, and restricted grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(bootstrapSQL);
    for (const file of migrationFiles.slice(0, migrationFiles.indexOf('017_attendance_excuse.sql'))) await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    await db.exec("insert into attendance(uni,week,status,manual_override,source_quiz) values('aa1001',1,'present',true,null),('aa1001',2,'absent',true,2),('aa1001',3,'excused',true,3)");
    const before = (await db.query('select uni,week,status,manual_override,source_quiz from attendance order by week')).rows;
    await db.exec(readFileSync(new URL('../supabase/migrations/017_attendance_excuse.sql', import.meta.url), 'utf8'));
    assert.deepEqual((await db.query('select uni,week,status,manual_override,source_quiz from attendance order by week')).rows, before);
    const triggers = (await db.query("select tgname from pg_trigger where tgrelid='attendance'::regclass and not tgisinternal")).rows.map(r => r.tgname);
    for (const name of ['attendance_audit', 'preview_guard', 'quiz_clears_excuse']) assert.ok(triggers.includes(name));
    const fn = (await db.query("select prosecdef,proconfig from pg_proc where oid='public.save_attendance(integer,jsonb)'::regprocedure")).rows[0];
    assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.includes('search_path=""'));
    for (const role of ['anon', 'authenticated'])
      assert.equal((await db.query("select has_function_privilege($1,'private.quiz_clears_excuse()','execute') allowed", [role])).rows[0].allowed, false);
  } finally { await db.close(); }
});

test('017 keeps every group set field from 007, including submission_deadline', async () => {
  await h.as('teacher');
  const sets = (await h.rpc('class_data')).sets;
  for (const s of sets) assert.ok('submission_deadline' in s, 'group sets keep submission_deadline');
});
