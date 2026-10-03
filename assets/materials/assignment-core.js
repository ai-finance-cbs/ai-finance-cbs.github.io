import { gradeCode } from './class-core.js';

export const ASSIGNMENT_CODES = ['M1','M2','M3','M4','M5','FP','O1','O2','O3'];
export function assignmentSlug(code) {
  return code === 'FP' ? 'final-prototype' : /^M[1-5]$/.test(code) ? `milestone-${code[1]}` : 'optional-tasks';
}
export function itemName(item, assignments = []) {
  const code = gradeCode(item), week = code === 'FP' ? 6 : /^M[1-5]$/.test(code) ? Number(code[1]) : null;
  if (code === 'FP') return 'Final Prototype';
  const title = (assignments.find(a => a.id === week)?.title || item.title || '').replace(/^Milestone\s*#?\d+\s*:?\s*/i,'');
  return /^M[1-5]$/.test(code) ? `Milestone #${week}${title ? `: ${title}` : ''}` : item.title;
}
export function dueCountdown(due, now = Date.now()) {
  const remaining = Date.parse(due) - Number(now);
  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return 'Past due';
  const minutes = Math.ceil(remaining / 60000), hours = Math.floor(minutes / 60);
  return remaining >= 86400000 ? `${Math.floor(hours / 24)} days ${hours % 24} hrs remaining`
    : `${hours} hrs ${minutes % 60} min remaining`;
}
export function assignmentBody(code, body) {
  if (!ASSIGNMENT_CODES.includes(code)) throw new Error('Choose an assignment.');
  if (typeof body !== 'string' || [...body].length > 50000) throw new Error('Instructions must be at most 50,000 characters.');
  return body;
}
