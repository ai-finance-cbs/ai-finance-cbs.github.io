import { GRADE_ITEMS, gradeCode } from './class-core.js';

// The first unfinished class owns the landing page. Dates without end times do not guess a cutoff.
export function currentWeek(sessions, now = Date.now()) {
  const dated = sessions.filter(s => s.week >= 1 && s.week <= 6 && Number.isFinite(Date.parse(s.ends_at)));
  if (!dated.length) return 1;
  return dated.filter(s => Date.parse(s.ends_at) > Number(now)).sort((a, b) => a.week - b.week)[0]?.week ?? 6;
}
export const weekSlug = week => `week-${Math.min(Math.max(week, 1), 6)}`;
export function courseTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
export function ownGroup(data, item, uni) {
  const membership = data.members.find(m => m.set_id === item.group_set_id && m.uni === uni);
  return data.groups.find(g => g.id === membership?.group_id);
}
export function ownSubmission(data, item, uni) {
  const group = ownGroup(data, item, uni);
  return data.submissions.find(s => s.item_id === item.id && (item.mode === 'group' ? s.group_id === group?.id : s.owner_uni === uni));
}
export const submissionStatus = submission => submission ? submission.late ? 'Late' : 'Submitted' : 'Not submitted';
export const fileReleased = (file, now = Date.now()) => file.released || (file.release_at && Date.parse(file.release_at) <= now);
export const inClassFile = file => file.category === 'in_class';

export function studentGradeRows(data) {
  // Public assessment names provide ordering, never scores or release state.
  return GRADE_ITEMS.map(base => {
    const code = gradeCode(base);
    const released = data.items.find(item => gradeCode(item) === code && item.released);
    const item = data.submission_items.find(item => gradeCode(item) === code);
    const submission = data.submissions.find(s => s.item_id === (item?.id ?? released?.id));
    return { ...base, ...item, ...released, code, released: !!released, submission,
      grade: released ? data.grades.find(g => g.item_id === released.id) : null };
  });
}
