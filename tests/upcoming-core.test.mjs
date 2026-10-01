import test from 'node:test';
import assert from 'node:assert/strict';
import { courseToday, nextSession, classDate, readingMinutes, announcementText } from '../assets/materials/upcoming-core.js';

test('next class uses the earliest date today or later, not array order', () => {
  const sessions = [{week:1,date:'2027-01-10'}, {week:3,date:'2027-01-24'}, {week:2,date:'2027-01-17'}];
  assert.equal(nextSession(sessions, '2027-01-17').week, 2);
  assert.equal(nextSession(sessions, '2027-01-18').week, 3);
  assert.equal(nextSession(sessions, '2027-01-25'), null);
  assert.equal(nextSession([{week:1,date:null},{week:2,date:'2027-01-17'}], '2027-01-16').week, 2);
  assert.equal(nextSession([{week:1,date:null},{week:2,date:'2027-01-17'}], '2027-01-18'), null);
});
test('unset dates select Week 1 and New York determines today at UTC midnight', () => {
  assert.equal(nextSession([{week:2,date:null},{week:1,date:null}]).week, 1);
  assert.equal(nextSession([]).week, 1);
  assert.equal(courseToday(new Date('2027-01-17T02:00:00Z')), '2027-01-16');
  assert.equal(courseToday(new Date('2027-07-17T03:00:00Z')), '2027-07-16');
  assert.equal(classDate('2027-01-17'), 'Jan 17, 2027');
  assert.equal(classDate(null), '');
});
test('reading times and short announcement input retain text safely', () => {
  assert.equal(readingMinutes('2 hr 31 min'), 151);
  assert.equal(readingMinutes('25 min'), 25);
  assert.equal(readingMinutes(null), 0);
  assert.deepEqual(announcementText({body:' <script>plain text</script> '}), {title:'',body:'<script>plain text</script>'});
  for (const row of [{body:'  '},{body:'a'.repeat(2001)},{title:'a'.repeat(201),body:'x'}]) assert.throws(() => announcementText(row));
});
