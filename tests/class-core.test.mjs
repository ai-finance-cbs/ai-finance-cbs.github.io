import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE_ITEMS,
  gradeCode,
  zones,
  pageAllowed,
  canWrite,
  gradeTotal,
  toCsv,
} from '../assets/materials/class-core.js';
test('role pages and preview write controls match the server contract', () => {
  const expected = {
    instructor: [
      'landing',
      'week',
      'attendance',
      'groups',
      'gradebook',
      'roster',
      'files',
      'settings',
    ],
    grader: ['landing', 'week', 'gradebook', 'attendance', 'groups'],
    student: ['landing', 'week', 'grades', 'attendance', 'groups'],
    auditor: ['landing', 'week'],
    unlisted: [],
  };
  for (const [role, pages] of Object.entries(expected))
    for (const page of [...expected.instructor, 'grades', 'submit'])
      assert.equal(pageAllowed(page, { role }), pages.includes(page), `${role}: ${page}`);
  const preview = { role: 'student', actor_role: 'instructor', view_as: { uni: 'ab1234' } };
  assert.equal(canWrite(preview), false);
  assert.equal(zones(preview).instructor, false);
  assert.equal(pageAllowed('gradebook', preview), false);
});
test('optional points cap at fifteen and overall total at one hundred; blank differs from zero', () => {
  assert.equal(
    GRADE_ITEMS.filter((i) => !i.optional).reduce((a, i) => a + i.max_points, 0),
    100,
  );
  const all = GRADE_ITEMS.map((i) => ({ item_id: i.id, score: i.max_points }));
  assert.deepEqual(gradeTotal(GRADE_ITEMS, all), {
    core: 100,
    optional: 35,
    bonus: 15,
    total: 100,
    missing: 0,
  });
  assert.deepEqual(
    gradeTotal(GRADE_ITEMS, [
      { item_id: 1, score: 0 },
      { item_id: 13, score: 10 },
      { item_id: 14, score: 10 },
    ]),
    { core: 0, optional: 20, bonus: 15, total: 15, missing: 13 },
  );
});
test('archive CSV exports escape quotes and neutralize formulas', () => {
  assert.equal(toCsv([['=evil', 'a"b']]), '"\'=evil","a""b"');
});
test('archive grade codes preserve the original item order', () => {
  assert.deepEqual(GRADE_ITEMS.map(gradeCode), ['M1','M2','M3','M4','M5','FP','Q1','Q2','Q3','Q4','Q5','PA','O1','O2','O3','O4']);
});
