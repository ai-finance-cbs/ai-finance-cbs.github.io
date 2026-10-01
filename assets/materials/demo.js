import { OWNER, extractUni, fakeAuthAllowed, normalizeUni, resolveRole } from './core.js';
const KEY = 'b8403-demo-state-v1';
const SESSION = 'b8403-demo-user-v1';
// Synthetic examples only. Actual assignment text must never enter public assets.
function seed() {
  return {
    roster: [{ uni: 'ab1234', name: 'Demo Student' }],
    allowlist: [{ email: OWNER, role: 'instructor_ta' }, { email: 'observer@columbia.edu', role: 'observer' }],
    assignments: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: i === 5 ? 'Demo final prototype' : `Demo milestone ${i + 1}`, due: `Before Week ${i + 1}`, points: i === 5 ? 25 : 10, description: 'Synthetic local example. Real assignment instructions load only from Supabase.', deliverable: 'Demo submission.', grading: 'Demo criteria.', observer_visible: i === 0 })),
    files: [],
  };
}
export function createDemo() {
  if (!fakeAuthAllowed(window.location)) throw new Error('Local demo is available only on http://127.0.0.1.');
  const read = () => JSON.parse(sessionStorage.getItem(KEY) || 'null') || seed();
  const save = data => sessionStorage.setItem(KEY, JSON.stringify(data));
  const user = () => JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  const access = () => {
    const u = user(); if (!u) return null;
    const data = read(); const role = resolveRole(u.email, u.uni, data.roster, data.allowlist);
    return { email: u.email, uni: u.uni, role, needs_uni: role === 'unlisted' && !u.uni && u.email.endsWith('@gsb.columbia.edu') };
  };
  const requireRole = (admin = false) => {
    const a = access();
    if (!a || a.role === 'unlisted' || (admin && a.role !== 'instructor_ta')) throw new Error('You do not have access to this material.');
    return a;
  };
  const visible = row => { const a = requireRole(); return a.role !== 'observer' || row.observer_visible; };
  return {
    demo: true,
    async getAccess() { return access(); },
    async pickRole(role) {
      const email = { instructor: OWNER, student: 'ab1234@columbia.edu', observer: 'observer@columbia.edu', unlisted: 'zz9999@columbia.edu', gsb: 'demo@gsb.columbia.edu' }[role];
      if (!email) throw new Error('Choose a demo role.');
      sessionStorage.setItem(SESSION, JSON.stringify({ email, uni: extractUni(email) })); return access();
    },
    async signOut() { sessionStorage.removeItem(SESSION); },
    async claimUni(value) {
      const u = user(); const uni = normalizeUni(value);
      if (!u || !u.email.endsWith('@gsb.columbia.edu') || u.uni) throw new Error('UNI cannot be changed.');
      if (!read().roster.some(row => row.uni === uni)) throw new Error('You are not on the class list. Contact oh@gsb.columbia.edu.');
      u.uni = uni; sessionStorage.setItem(SESSION, JSON.stringify(u)); return access();
    },
    async assignments() { requireRole(); return read().assignments.filter(visible); },
    async files() { requireRole(); return read().files.filter(visible).map(({ data, ...row }) => row); },
    async adminData() { requireRole(true); const d = read(); return { roster: d.roster, allowlist: d.allowlist }; },
    async replaceRoster(rows) { requireRole(true); const d = read(); d.roster = rows; save(d); },
    async saveAllowlist(entry) { requireRole(true); const d = read(); d.allowlist = d.allowlist.filter(r => r.email !== entry.email); d.allowlist.push(entry); save(d); },
    async removeAllowlist(email) { requireRole(true); if (email === OWNER) throw new Error('The instructor cannot be removed.'); const d = read(); d.allowlist = d.allowlist.filter(r => r.email !== email); save(d); },
    async saveAssignment(row) { requireRole(true); const d = read(); d.assignments = d.assignments.map(a => a.id === row.id ? row : a); save(d); },
    async uploadFile(file, fields) {
      requireRole(true); const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const d = read(); const id = crypto.randomUUID(); d.files.push({ id, ...fields, storage_path: `${id}.pdf`, created_at: new Date().toISOString(), data }); save(d);
    },
    async setFileVisibility(id, value) { requireRole(true); const d = read(); d.files = d.files.map(f => f.id === id ? { ...f, observer_visible: value } : f); save(d); },
    async deleteFile(id) { requireRole(true); const d = read(); d.files = d.files.filter(f => f.id !== id); save(d); },
    async fileUrl(id) { const file = read().files.find(f => f.id === id); if (!file || !visible(file)) throw new Error('File unavailable.'); const blob = await (await fetch(file.data)).blob(); const url = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(url), 300000); return url; },
  };
}
