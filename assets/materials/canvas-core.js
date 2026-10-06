export const CANVAS_HOST = 'https://courseworks2.columbia.edu';
export function canvasId(value) {
  const id = String(value ?? '').trim();
  if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Enter a valid Canvas ID.');
  return id;
}
export function mappingValues(siteKey, assignmentId, kind, week) {
  const key = String(siteKey || '').trim().toUpperCase();
  const valid = kind === 'milestone' ? /^M[1-5]$/.test(key) && Number(key.slice(1)) === Number(week)
    : kind === 'final' ? key === 'FP' && Number(week) === 6
    : kind === 'quiz' ? /^Q[1-6]$/.test(key) && Number(key.slice(1)) === Number(week)
    : kind === 'optional' ? /^O[1-9][0-9]?$/.test(key) && (week == null || week === '' || Number(week) >= 1 && Number(week) <= 6)
    : kind === 'participation' && key === 'PA' && (week == null || week === '');
  if (!valid) throw new Error('Choose a valid site item, kind, and week.');
  return {site_key:key,canvas_assignment_id:assignmentId ? canvasId(assignmentId) : null,kind,week:week == null || week === '' ? null : Number(week)};
}
export function canvasPresent(submission) {
  return submission?.score != null && submission.missing === false && submission.late_policy_status !== 'missing';
}
export function canvasPosted(submission) {
  return !!submission?.posted_at && submission.assignment_visible === true;
}
export function canvasStatus(submission, mapping = {}, now = Date.now()) {
  if (!submission) return 'Status unavailable';
  if (!submission.assignment_visible) return 'Not assigned';
  if (submission.excused) return 'Excused';
  // Canvas can flag untaken optional work as missing. It is not a course obligation.
  if (mapping.kind === 'optional' && submission.workflow_state === 'unsubmitted' && !submission.submitted_at) return 'Optional';
  if (submission.missing || submission.late_policy_status === 'missing') return 'Missing';
  if (submission.late || submission.late_policy_status === 'late') return 'Late';
  if (['submitted','pending_review','graded'].includes(submission.workflow_state)) return 'Done';
  if (mapping.kind === 'optional') return 'Optional';
  if (!submission.cached_due_at) return 'No due date';
  return new Date(submission.cached_due_at).getTime() < now ? 'Missing' : 'Not yet due';
}
export function suggestedAssignment(item, assignments) {
  const clean = value => value.toLowerCase().replace(/[^a-z0-9]/g,'');
  const matches = assignments.filter(a => clean(a.name) === clean(item.title || item.site_key));
  return matches.length === 1 ? matches[0] : null;
}
export function canvasItems(items) {
  const rows = items.map(i => ({site_key:i.code,title:i.title,kind:i.quiz_week ? 'quiz' : i.code === 'FP' ? 'final' : i.code === 'PA' ? 'participation' : i.optional ? 'optional' : 'milestone',week:i.quiz_week || (i.code === 'FP' ? 6 : /^M[1-5]$/.test(i.code) ? Number(i.code.slice(1)) : null)}));
  // A week can be mapped even when the old gradebook had no quiz column for it.
  for (let week=1;week<=6;week++) if (!rows.some(r=>r.site_key===`Q${week}`)) rows.push({site_key:`Q${week}`,title:`In-class quiz ${week}`,kind:'quiz',week});
  return rows;
}
