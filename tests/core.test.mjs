import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isColumbiaEmail, normalizeUni, extractUni, resolveRole, parseRoster, fakeAuthAllowed, safeReturnPath, validatePdf } from '../assets/materials/core.js';

test('email domains are exact, normalized, and reject suffix attacks', () => {
  for (const email of ['ab1234@columbia.edu', 'Oh@GSB.Columbia.edu ', ' demo+alias@columbia.edu']) assert.equal(isColumbiaEmail(email), true);
  for (const email of ['a@columbia.edu.evil.com', 'a@evilcolumbia.edu', 'a@sub.columbia.edu', 'a@@columbia.edu', 'a b@columbia.edu', 'columbia.edu', 'a@gmail.com', '']) assert.equal(isColumbiaEmail(email), false, email);
});
test('UNI comes from Columbia email; GSB requires a separate claim', () => {
  assert.equal(extractUni(' AB1234@Columbia.edu '), 'ab1234');
  assert.equal(extractUni('oh@gsb.columbia.edu'), null);
  assert.equal(extractUni('ab1234@columbia.edu.evil'), null);
  assert.equal(extractUni('arbitrary@columbia.edu'), null);
  assert.equal(normalizeUni(' CD5678 '), 'cd5678');
  assert.equal(normalizeUni('123456'), null);
});
test('Canvas CSV normalizes UNI and previews missing and duplicate entries', () => {
  const result = parseRoster(readFileSync(new URL('./fixtures/canvas-roster.csv', import.meta.url), 'utf8'));
  assert.deepEqual(result.rows, [{ uni: 'ab1234', name: 'Student, Demo' }, { uni: 'cd5678', name: 'Second Student' }]);
  assert.equal(result.errors.length, 0); assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].reason, /Missing/); assert.match(result.issues[1].reason, /Duplicate/);
});
test('CSV handles BOM, CRLF, quoted newlines and quotes, and alternate headers', () => {
  const result = parseRoster('\uFEFF sTuDeNt ,SIS_LOGIN_ID\r\n"A, ""B""\nC",AB1234@columbia.edu\r\n');
  assert.deepEqual(result.rows, [{ uni: 'ab1234', name: 'A, "B"\nC' }]);
  assert.deepEqual(result.errors, []);
  assert.equal(parseRoster('Name,SIS User ID\nA,AB1234').rows[0].uni, 'ab1234');
});
test('CSV rejects invalid quoting, absent UNI columns, ambiguous headers, and empty imports', () => {
  for (const csv of ['Student,UNI\n"Unfinished,ab1234', 'Name,UNI\n"Name"X,ab1234', 'Name,ID\nA,123', 'Name,UNI,uni\nA,ab1234,ab1234', 'Student,UNI\n', '']) assert.ok(parseRoster(csv).errors.length, csv);
  assert.equal(parseRoster('Name,UNI\nA,ab1234,extra').issues.length, 1);
  assert.ok(parseRoster('x'.repeat(1_000_001)).errors.length);
});
test('role resolution checks domain before allowlist, then instructor/auditor before roster', () => {
  const roster = [{ uni: 'ab1234' }]; const list = [{ email: 'oh@gsb.columbia.edu', role: 'instructor' }, { email: 'ab1234@columbia.edu', role: 'auditor' }, { email: 'x@gmail.com', role: 'instructor' }];
  assert.equal(resolveRole('oh@gsb.columbia.edu', null, roster, list), 'instructor');
  assert.equal(resolveRole('ab1234@columbia.edu', null, roster, []), 'student');
  assert.equal(resolveRole('ab1234@columbia.edu', null, roster, list), 'auditor');
  assert.equal(resolveRole('someone@gsb.columbia.edu', 'ab1234', roster, list), 'student');
  assert.equal(resolveRole('ab1234@columbia.edu', null, [], list.filter(x => x.role !== 'auditor')), 'unlisted');
  assert.equal(resolveRole('x@gmail.com', 'ab1234', roster, list), 'unlisted');
});
test('fake authentication is restricted to exact loopback HTTP origin', () => {
  assert.equal(fakeAuthAllowed(new URL('http://127.0.0.1:4173/?fakeauth=instructor')), true);
  for (const url of ['https://ai-finance-cbs.github.io/?fakeauth=instructor', 'http://127.0.0.1.evil/', 'http://localhost/', 'https://127.0.0.1/']) assert.equal(fakeAuthAllowed(new URL(url)), false);
});
test('OAuth return paths cannot navigate to another origin', () => {
  const origin = 'https://ai-finance-cbs.github.io';
  assert.equal(safeReturnPath('/materials/assignments/#milestone-2', origin), '/materials/assignments/#milestone-2');
  for (const path of ['https://evil.test', '//evil.test', 'javascript:alert(1)']) assert.equal(safeReturnPath(path, origin), '/');
});
test('uploads require a PDF header, extension, and bounded size', async () => {
  await validatePdf(new File(['%PDF-1.4\n%%EOF'], 'notes.pdf'));
  await assert.rejects(validatePdf(new File(['not a PDF'], 'notes.pdf')), /header/);
  await assert.rejects(validatePdf(new File(['%PDF-'], 'notes.html')), /PDF/);
  await assert.rejects(validatePdf(new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.pdf')), /20 MB/);
});
