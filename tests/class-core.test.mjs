import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE_ITEMS,
  zones,
  pageAllowed,
  canWrite,
  gradeTotal,
  parseGradesCsv,
  parseQuizCsv,
  parsePresentCsv,
  checkGroupChange,
  toCsv,
} from '../assets/materials/class-core.js';
const roster = [{ uni: 'ab1234' }, { uni: 'cd5678' }];
test('role pages and preview write controls match the server contract', () => {
  const expected = {
    instructor: [
      'assignments',
      'lecture-notes',
      'attendance',
      'groups',
      'gradebook',
      'roster',
      'files',
      'settings',
    ],
    grader: ['assignments', 'lecture-notes', 'gradebook', 'attendance'],
    student: ['assignments', 'lecture-notes', 'attendance', 'groups'],
    auditor: ['assignments', 'lecture-notes'],
    unlisted: [],
  };
  for (const [role, pages] of Object.entries(expected))
    for (const page of expected.instructor)
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
test('CSV imports validate all rows, preserve zero, and allow deliberate clearing', () => {
  const quiz = GRADE_ITEMS[6];
  assert.deepEqual(parseQuizCsv('uni,score\nab1234,0\ncd5678,', quiz, roster), [
    { uni: 'ab1234', item_id: 7, score: 0 },
    { uni: 'cd5678', item_id: 7, score: null },
  ]);
  for (const score of ['-1', '4', '1.111', 'NaN', 'Infinity', '1e2'])
    assert.throws(() => parseQuizCsv(`uni,score\nab1234,${score}`, quiz, roster));
  for (const csv of [
    'uni,score\nzz9999,2',
    'uni,score\nab1234,2\nab1234,1',
    'uni,score\nab1234,2,3',
  ])
    assert.throws(() => parseQuizCsv(csv, quiz, roster));
  assert.throws(() => parseGradesCsv('uni,unknown\nab1234,2', GRADE_ITEMS, roster));
  assert.deepEqual(parsePresentCsv('UNI\nab1234\nab1234\ncd5678@columbia.edu', roster), [
    { uni: 'ab1234', status: 'present' },
    { uni: 'cd5678', status: 'present' },
  ]);
  assert.throws(() => parsePresentCsv('ab1234\nzz9999', roster));
  assert.match(toCsv([['=evil', 'a"b']]), /"'=evil","a""b"/);
});
test('group checks respect preview, deadlines, capacity, and own membership', () => {
  const data = {
      sets: [{ id: 's', max_size: 1, is_open: true }],
      groups: [{ id: 'g', set_id: 's' }],
      members: [{ group_id: 'g', uni: 'cd5678' }],
    },
    a = { role: 'student', uni: 'ab1234' };
  assert.throws(() => checkGroupChange(data, a, 's', 'g'), /full/);
  assert.throws(() => checkGroupChange(data, { ...a, view_as: {} }, 's', null), /read-only/);
  assert.throws(() => checkGroupChange(data, a, 's', null, 'cd5678'), /not your/);
  data.sets[0].deadline = '2000-01-01';
  assert.throws(() => checkGroupChange(data, a, 's', null), /closed/);
});
