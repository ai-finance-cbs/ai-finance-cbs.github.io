import { classSeed, extendDemo } from './class-demo.js';
import { OWNER, extractUni, fakeAuthAllowed, normalizeUni, resolveRole } from './core.js';
const KEY = 'b8403-demo-state-v3';
const SESSION = 'b8403-demo-user-v1';
// Synthetic examples only. Actual assignment text must never enter public assets.
function seed() {
  return {
    ...classSeed(),
    roster: [{ uni: 'ab1234', name: 'Demo Student' }, { uni: 'cd5678', name: 'Second Student' }, { uni: 'ef9012', name: 'Third Student' }],
    allowlist: [{ email: OWNER, role: 'instructor' }, { email: 'grader@columbia.edu', role: 'grader' }, { email: 'auditor@columbia.edu', role: 'auditor' }],
    assignments: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: i === 5 ? 'Demo final prototype' : `Demo milestone ${i + 1}`, due: `Before Week ${i + 1}`, points: i === 5 ? 25 : 10, description: 'Synthetic local example. Real assignment instructions load only from Supabase.', deliverable: 'Demo submission.', grading: 'Demo criteria.', auditor_visible: i === 0 })),
    files: [], student_accounts: [],
  };
}
export function createDemo() {
  if (!fakeAuthAllowed(window.location)) throw new Error('Local demo is available only on http://127.0.0.1.');
  const read = () => JSON.parse(sessionStorage.getItem(KEY) || 'null') || seed();
  const save = data => sessionStorage.setItem(KEY, JSON.stringify(data));
  const user = () => JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  const access = () => {
    const u = user(); if (!u) return null;
    const data = read(); const linkedUni = data.student_accounts.find(a => a.email === u.email)?.uni;
    const actor_role = data.test_accounts.find(t => t.email === u.email)?.role || resolveRole(u.email, linkedUni || (u.email.endsWith('@columbia.edu') ? u.uni : null), data.roster, data.allowlist);
    const preview = actor_role === 'instructor' && u.preview_uni ? { uni: u.preview_uni, name: data.roster.find(r => r.uni === u.preview_uni)?.name || `Test student ${u.preview_uni}` } : null;
    const role = preview ? 'student' : actor_role;
    return { email: u.email, uni: preview?.uni || linkedUni || u.uni, role, actor_role, view_as: preview, needs_uni: role === 'unlisted' && !u.uni && u.email.endsWith('@gsb.columbia.edu') };
  };
  const requireRole = (admin = false) => {
    const a = access();
    if (!a || a.role === 'unlisted' || (admin && a.role !== 'instructor')) throw new Error('You do not have access to this material.');
    return a;
  };
  const visible = row => { const a = requireRole(); return a.role !== 'auditor' || row.auditor_visible; };
  return {
    ...extendDemo({ read, save, user, access, saveUser: u => sessionStorage.setItem(SESSION, JSON.stringify(u)) }),
    demo: true,
    async getAccess() { return access(); },
    async pickRole(role) {
      const email = { instructor: OWNER, grader: 'grader@columbia.edu', student: 'ab1234@columbia.edu', auditor: 'auditor@columbia.edu', unlisted: 'zz9999@columbia.edu', gsb: 'demo@gsb.columbia.edu', test: 'teststudent@example.test' }[role];
      if (!email) throw new Error('Choose a demo role.');
      sessionStorage.setItem(SESSION, JSON.stringify({ email, uni: role === 'test' ? 'test1' : extractUni(email) })); return access();
    },
    async signOut() { sessionStorage.removeItem(SESSION); },
    async claimUni(value) {
      if (access()?.view_as) throw new Error('Student preview is read-only.');
      const u = user(); const uni = normalizeUni(value);
      if (!u || !u.email.endsWith('@gsb.columbia.edu') || u.uni) throw new Error('UNI cannot be changed.');
      if (!read().student_accounts.some(a => a.email === u.email && a.uni === uni)) throw new Error('Ask the instructor to link your CBS email to your UNI.');
      u.uni = uni; sessionStorage.setItem(SESSION, JSON.stringify(u)); return access();
    },
    async assignments() { requireRole(); return read().assignments.filter(visible); },
    async files() { requireRole(); return read().files.filter(visible).map(({ data, ...row }) => row); },
    async adminData() { requireRole(true); const d = read(); return { roster: d.roster, allowlist: d.allowlist }; },
    async studentAccounts() { requireRole(true); return read().student_accounts; },
    async linkStudent(email, uni) { requireRole(true); const d=read(); if(uni && !d.roster.some(r=>r.uni===uni)) throw new Error('Student not found.'); if(!/^[^@]+@gsb[.]columbia[.]edu$/.test(email)) throw new Error('Enter a CBS email.'); d.student_accounts=d.student_accounts.filter(a=>a.email!==email); if(uni)d.student_accounts.push({email,uni}); save(d); },
    async replaceRoster(rows) { requireRole(true); const d = read(); d.roster = rows; save(d); },
    async saveAllowlist(entry) { requireRole(true); if (entry.email === OWNER || !['instructor','grader','auditor'].includes(entry.role)) throw new Error('Invalid role change.'); const d = read(); d.allowlist = d.allowlist.filter(r => r.email !== entry.email); d.allowlist.push(entry); save(d); },
    async removeAllowlist(email) { requireRole(true); if (email === OWNER) throw new Error('The instructor cannot be removed.'); const d = read(); d.allowlist = d.allowlist.filter(r => r.email !== email); save(d); },
    async saveAssignment(row) { requireRole(true); const d = read(); d.assignments = d.assignments.map(a => a.id === row.id ? row : a); save(d); },
    async uploadFile(file, fields) {
      requireRole(true); const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const d = read(); const id = crypto.randomUUID(); d.files.push({ id, ...fields, storage_path: `${id}.pdf`, created_at: new Date().toISOString(), data }); save(d);
    },
    async setFileVisibility(id, value) { requireRole(true); const d = read(); d.files = d.files.map(f => f.id === id ? { ...f, auditor_visible: value } : f); save(d); },
    async deleteFile(id) { requireRole(true); const d = read(); d.files = d.files.filter(f => f.id !== id); save(d); },
    async fileUrl(id) { const file = read().files.find(f => f.id === id); if (!file || !visible(file)) throw new Error('File unavailable.'); const blob = await (await fetch(file.data)).blob(); const url = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(url), 300000); return url; },
  };
}
