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
  if (!submission.assignment_visible) return 'Status unavailable';
  if (submission.excused) return 'Excused';
  // Canvas can flag untaken optional work as missing. It is not a course obligation.
  if (mapping.kind === 'optional' && !submission.submitted_at && (submission.workflow_state === 'unsubmitted'
    || submission.missing || submission.late_policy_status === 'missing')) return 'Optional';
  if (mapping.kind !== 'optional' && (submission.missing || submission.late_policy_status === 'missing')) return 'Missing';
  if (submission.late || submission.late_policy_status === 'late') return 'Late';
  if (['submitted','pending_review','graded'].includes(submission.workflow_state)) return 'Done';
  if (mapping.kind === 'optional') return 'Optional';
  if (!submission.cached_due_at) return 'No due date';
  return new Date(submission.cached_due_at).getTime() <= now ? 'Missing' : 'Not yet due';
}
export function canvasStudentStatus(submission, mapping = {}, now = Date.now()) {
  if (!submission?.assignment_visible) return 'Status unavailable';
  if (submission.posted_visible) return canvasStatus(submission,mapping,now);
  // Unposted status ignores every grading flag, including manually set late/missing flags.
  const types=mapping.submission_types || [],receipt=!!submission.submitted_at || ['submitted','pending_review'].includes(submission.workflow_state);
  if (types.length && types.every(type=>['on_paper','none','external_tool'].includes(type))
    && (!types.includes('external_tool') || !receipt)) return 'Not posted';
  if (receipt)
    return submission.submitted_at && submission.cached_due_at && Date.parse(submission.submitted_at)>Date.parse(submission.cached_due_at) ? 'Late' : 'Done';
  if (mapping.kind==='optional') return 'Optional';
  if (!submission.cached_due_at) return 'No due date';
  return Date.parse(submission.cached_due_at)<=now ? 'Missing' : 'Not yet due';
}
export function canvasAvailable(data, now = Date.now()) {
  const runs = [...(data.runs || [])].sort((a,b) => Date.parse(b.started_at)-Date.parse(a.started_at));
  return !!data.course?.generation && runs.find(r => r.status !== 'running')?.status === 'succeeded'
    && !runs.some(r => r.status === 'running' && now-Date.parse(r.started_at)>600000);
}
// This projection is used only by the synthetic backend. SQL enforces it for real accounts.
export function canvasStudentProjection(data, enrollment, now = Date.now()) {
  const available = !!enrollment && canvasAvailable(data, now);
  return {term_id:data.term_id,last_synced_at:data.course?.last_synced_at || null,available,
    items:data.mappings.map(m => {
      const a=data.assignments.find(a=>String(a.id)===String(m.canvas_assignment_id));
      const s=enrollment && data.submissions.find(s=>String(s.user_id)===String(enrollment.user_id) && String(s.assignment_id)===String(m.canvas_assignment_id));
      const visible=!!(a?.published && s?.assignment_visible), posted=!!(available && visible && s.posted_visible);
      return {site_key:m.site_key,kind:m.kind,week:m.week,title:m.title || null,status:available && visible ? canvasStudentStatus(s,{...m,submission_types:a.submission_types},now) : 'Status unavailable',
        due_at:available && visible ? s.cached_due_at : null,
        url:visible ? `${CANVAS_HOST}/courses/${data.course.course_id}/assignments/${a.id}` : null,
        posted_visible:posted,score:posted ? s.score : null,grade:posted ? s.grade : null,
        points_possible:available && visible ? a.points_possible : null};
    }),
    groups:available ? data.groups.filter(g=>data.group_members.some(m=>String(m.group_id)===String(g.id) && String(m.user_id)===String(enrollment.user_id)))
      .map(g=>({...g,members:data.group_members.filter(m=>String(m.group_id)===String(g.id)).map(m=>({name:m.name}))})) : []};
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
