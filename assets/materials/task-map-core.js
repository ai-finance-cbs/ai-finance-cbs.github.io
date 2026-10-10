export const TASK_LABELS = ['Process', 'Predict', 'Persuade', 'Own'];
export const TASK_LIMITS = { name:80, description:400, reasoning:2000, ai_use:600, job:120, tasks:12 };
export const emptyTask = () => ({name:'', description:'', label:null});
export const emptyTaskMap = () => ({job:{firm_type:'', role:'', duration:''},
  tasks:Array.from({length:10}, emptyTask), look_ahead:{...emptyTask(), reasoning:''}, ai_use:''});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => typeof value === 'string' && value.trim().length > 0;
export const completeTask = task => present(task.name) && present(task.description) && TASK_LABELS.includes(task.label);
export const wordCount = value => value.trim().split(/\s+/u).filter(Boolean).length;
export function taskTally(tasks) {
  return Object.fromEntries(TASK_LABELS.map(label => [label, tasks.filter(t => t.label === label).length]));
}
export function taskMapClosed(due, now = Date.now()) {
  return !due || !Number.isFinite(Date.parse(due)) || Number(now) >= Date.parse(due);
}
// Validation is repeated in PostgreSQL. Browser validation only improves feedback.
export function validateTaskMap(payload, submit = false) {
  if (!object(payload) || !object(payload.job) || !Array.isArray(payload.tasks) || !object(payload.look_ahead))
    throw new Error('Provide a job, tasks, and look-ahead task.');
  function fields(row, limits, label = false) {
    if (!object(row) || Object.keys(row).some(k => !Object.hasOwn(limits,k) && !(label && k === 'label')))
      throw new Error('Invalid task-map fields.');
    for (const [key, limit] of Object.entries(limits)) {
      if (typeof row[key] !== 'string' || [...row[key]].length > limit)
        throw new Error(`${key.replaceAll('_',' ')} must be text of at most ${limit} characters.`);
    }
    if (label && row.label !== null && !TASK_LABELS.includes(row.label)) throw new Error('Choose Process, Predict, Persuade, or Own.');
  }
  fields(payload.job, {firm_type:120, role:120, duration:120});
  if (payload.tasks.length > 12) throw new Error('Use at most 12 tasks.');
  for (const task of payload.tasks) fields(task, {name:80, description:400}, true);
  fields(payload.look_ahead, {name:80, description:400, reasoning:2000}, true);
  if (typeof payload.ai_use !== 'string' || [...payload.ai_use].length > 600) throw new Error('AI use must be at most 600 characters.');
  if (submit && payload.tasks.filter(completeTask).length < 8) throw new Error('Complete at least 8 tasks with a name, description, and label before submitting.');
  // The look-ahead task needs a name, a description, and reasoning; it carries no label.
  if (submit && (!present(payload.look_ahead.name) || !present(payload.look_ahead.description) || !present(payload.look_ahead.reasoning))) throw new Error('Complete the look-ahead task and your reasoning before submitting.');
  return payload;
}
export function taskMapSummary(students) {
  const counts = {submitted:0, drafts:0, not_started:0};
  const tasks = [], lookAhead = [];
  for (const student of students) {
    const row = student.submission;
    counts[row?.status === 'submitted' ? 'submitted' : row ? 'drafts' : 'not_started']++;
    if (row?.status === 'submitted') {
      tasks.push(...row.tasks.filter(completeTask));
      lookAhead.push(row.look_ahead);
    }
  }
  return {counts, tally:taskTally(tasks), total:tasks.length,
    own:tasks.filter(t => t.label === 'Own'), lookAhead};
}
