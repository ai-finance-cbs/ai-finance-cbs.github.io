import { ownSubmission } from './week-core.js';

// Always read and write the wall clock in New York, regardless of the computer's zone.
export function newYorkInput(value) {
  if (!value) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function newYorkTime(value) {
  if (!value) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('Enter a valid New York date and time.');
  const wall = Date.parse(`${value}:00Z`);
  const matches = [4, 5].map(hours => new Date(wall + hours * 3600000).toISOString()).filter(time => newYorkInput(time) === value);
  if (!matches.length) throw new Error('This New York time does not exist during the March clock change.');
  if (matches.length > 1) throw new Error('This New York time occurs twice during the November clock change. Choose a time outside 1–2 AM.');
  return matches[0];
}
export function gradingSubmission(data, item, uni) {
  // A moved member keeps their original submitted work and copied grade in the grading view.
  return data.submissions.find(s => s.item_id === item.id && s.member_unis?.includes(uni)) || ownSubmission(data, item, uni);
}
export function groupOverride(data, item, uni, submission) {
  const baseline = data.group_grades?.find(g => g.item_id === item.id && g.group_id === submission?.group_id);
  if (baseline?.score == null || !submission?.member_unis?.includes(uni)) return false;
  const grade = data.grades.find(g => g.item_id === item.id && g.uni === uni);
  return grade?.score == null || Number(grade.score) !== Number(baseline.score);
}
// Optional tasks are independent of the weekly milestones.
export function submissionWeek(code) {
  if (code === 'FP') return 6;
  return /^M[1-5]$/.test(code) ? Number(code[1]) : null;
}
export const SUBMIT_CODES = ['M1','M2','M3','M4','M5','FP','O1','O2','O3'];
