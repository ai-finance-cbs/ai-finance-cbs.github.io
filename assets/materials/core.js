// Shared validation has no browser dependencies, so Node can test the same code.
export const OWNER = 'oh@gsb.columbia.edu';
export const WEEK_TITLES = ['AI Economics', 'AI Infrastructure', 'Processing Information with AI', 'Predicting Outcomes with AI', 'Persuading Stakeholders with AI', 'The Future of Finance with AI'];
export const ROLE_LABELS = { instructor: 'Instructor', grader: 'Grader', student: 'Student', auditor: 'Auditor', unlisted: 'Unlisted' };
export const normalizeEmail = value => value.trim().toLowerCase();
export function isColumbiaEmail(value) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(columbia\.edu|gsb\.columbia\.edu)$/.test(normalizeEmail(value));
}
export function normalizeUni(value) {
  const uni = value.trim().toLowerCase();
  return /^[a-z]{1,8}[0-9]{1,8}$/.test(uni) ? uni : null;
}
export function extractUni(email) {
  const e = normalizeEmail(email);
  return isColumbiaEmail(e) && e.endsWith('@columbia.edu') ? normalizeUni(e.split('@')[0]) : null;
}
export function resolveRole(email, uni, roster, allowlist) {
  if (!isColumbiaEmail(email)) return 'unlisted';
  const entry = allowlist.find(row => row.email === normalizeEmail(email));
  if (entry) return entry.role;
  const resolved = extractUni(email) ?? (uni ? normalizeUni(uni) : null);
  return roster.some(row => row.uni === resolved) ? 'student' : 'unlisted';
}
export function fakeAuthAllowed(location) {
  return location.hostname === '127.0.0.1' && location.protocol === 'http:';
}
export function safeReturnPath(value, origin, fallback = '/') {
  try { const url = new URL(value, origin); return url.origin === origin ? url.pathname + url.search + url.hash : fallback; }
  catch { return fallback; }
}

export async function validatePdf(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file.');
  if (file.size > 20 * 1024 * 1024 || file.size < 5) throw new Error('PDF must be between 5 bytes and 20 MB.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw new Error('This file does not have a PDF header.');
}
