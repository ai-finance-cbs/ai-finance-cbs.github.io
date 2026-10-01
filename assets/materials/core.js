// Shared validation has no browser dependencies, so Node can test the same code.
export const OWNER = 'oh@gsb.columbia.edu';
export const WEEK_TITLES = ['AI Economics', 'AI Infrastructure', 'Processing Information with AI', 'Predicting Outcomes with AI', 'Persuading Stakeholders with AI', 'The Future of Finance with AI'];
export const ROLE_LABELS = { instructor_ta: 'Instructor / TA', student: 'Student', observer: 'Observer', unlisted: 'Unlisted' };
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

// Small RFC 4180 reader: quoted commas, escaped quotes, embedded newlines, CRLF, and BOM.
function csvCells(text) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const endCell = () => { row.push(cell); cell = ''; closed = false; };
  const endRow = () => { endCell(); if (row.some(c => c.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else if (c === '"' && !cell.trim() && !closed) { cell = ''; quoted = true; }
    else if (c === '"' || (closed && c.trim())) throw new Error('Invalid CSV quoting. Export the CSV again from Canvas.');
    else if (!closed) cell += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV. Export the CSV again from Canvas.');
  endRow(); return rows;
}
export function parseRoster(csv) {
  const out = { rows: [], issues: [], errors: [] };
  if (csv.length > 1_000_000) return { ...out, errors: ['CSV must be smaller than 1 MB.'] };
  let data;
  try { data = csvCells(csv.replace(/^\uFEFF/, '')); } catch (e) { return { ...out, errors: [e.message] }; }
  const [head = [], ...rows] = data;
  const headers = head.map(h => h.trim().toLowerCase().replace(/[_\s]+/g, ' '));
  if (new Set(headers).size !== headers.length) out.errors.push('Duplicate column names.');
  const candidates = ['sis login id', 'uni', 'login id', 'sis user id'].map(h => headers.indexOf(h)).filter(i => i >= 0);
  const nameIndex = headers.findIndex(h => ['student', 'student name', 'name'].includes(h));
  if (!candidates.length) out.errors.push('No UNI column found. Use SIS Login ID, UNI, Login ID, or SIS User ID.');
  if (rows.length > 5000) out.errors.push('CSV contains more than 5,000 rows.');
  const seen = new Set();
  rows.slice(0, 5000).forEach((cells, i) => {
    const name = (cells[nameIndex] ?? '').trim(); let uni = null;
    for (const column of candidates) {
      const value = (cells[column] ?? '').trim().toLowerCase();
      uni = normalizeUni(value.endsWith('@columbia.edu') ? value.split('@')[0] : value);
      if (uni) break;
    }
    const reason = cells.length !== head.length ? 'Column count does not match the header.' : !uni ? 'Missing or invalid UNI.' : seen.has(uni) ? 'Duplicate UNI; first row retained.' : null;
    if (reason) out.issues.push({ row: i + 2, name, reason });
    else { seen.add(uni); out.rows.push({ uni, name: name.slice(0, 200) }); }
  });
  if (!out.rows.length) out.errors.push('No valid UNIs found. The current roster will not be replaced.');
  return out;
}
export async function validatePdf(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file.');
  if (file.size > 20 * 1024 * 1024 || file.size < 5) throw new Error('PDF must be between 5 bytes and 20 MB.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw new Error('This file does not have a PDF header.');
}
