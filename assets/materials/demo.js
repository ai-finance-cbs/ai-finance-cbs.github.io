import { extendAssignments } from './assignment-demo.js';
import { extendProfiles } from './profile-demo.js';
import { extendPrep } from './prep-demo.js';
import { extendTerms } from './term-demo.js';
import { announcementText } from './upcoming-core.js';
import { extendSubmissions, termData, mergeTerm, normalizeTerms } from './submission-demo.js';
import { classSeed, extendDemo } from './class-demo.js';
import { OWNER, extractUni, fakeAuthAllowed, resolveRole } from './core.js';
const KEY = 'b8403-demo-state-v3';
const SESSION = 'b8403-demo-user-v1';
// Synthetic examples only. Actual assignment text must never enter public assets.
function seed() {
  return {
    ...classSeed(),
    roster: [{ uni: 'ab1234', name: 'Demo Student' }, { uni: 'cd5678', name: 'Second Student' }, { uni: 'ef9012', name: 'Third Student' }],
    allowlist: [{ email: OWNER, role: 'instructor' }, { email: 'grader@columbia.edu', role: 'grader' }, { email: 'auditor@columbia.edu', role: 'auditor' }],
    assignments: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: i === 5 ? 'Demo final prototype' : `Demo milestone ${i + 1}`, due: `Before Week ${i + 1}`, points: i === 5 ? 25 : 10, description: 'Synthetic local example. Real assignment instructions load only from Supabase.', deliverable: 'Demo submission.', grading: 'Demo criteria.', auditor_visible: i === 0 })),
    files: [], student_accounts: [], announcements: [],
  };
}
export function createDemo() {
  if (!fakeAuthAllowed(window.location)) throw new Error('Local demo is available only on http://127.0.0.1.');
  const readAll = () => normalizeTerms(JSON.parse(sessionStorage.getItem(KEY) || 'null') || seed());
  const saveAll = data => sessionStorage.setItem(KEY, JSON.stringify(data));
  const user = () => JSON.parse(sessionStorage.getItem(SESSION) || 'null');
  const access = () => {
    const u = user(); if (!u) return null;
    const data = readAll(); const linkedUni = data.student_accounts.find(a => a.email === u.email)?.uni;
    const actor_role = data.test_accounts.find(t => t.email === u.email)?.role || resolveRole(u.email, linkedUni || (u.email.endsWith('@columbia.edu') ? u.uni : null), data.roster.filter(r => data.terms.some(t => t.id === r.term_id && t.status !== 'closed')), data.allowlist);
    const preview = actor_role === 'instructor' && u.preview_uni ? { uni: u.preview_uni, name: data.roster.find(r => r.uni === u.preview_uni)?.name || `Test student ${u.preview_uni}` } : null;
    const role = preview ? 'student' : actor_role;
    const active = data.terms.find(t => t.status === 'active');
    const uni = linkedUni || u.uni;
    const own = data.terms.filter(t => t.status !== 'closed' && data.roster.some(r => r.term_id === t.id && r.uni === uni));
    const term_id = preview ? u.preview_term || active?.id : role !== 'student' || data.test_accounts.some(t => t.email === u.email) ? active?.id : own.find(t => t.status === 'active')?.id || own.at(-1)?.id;
    return { email: u.email, uni: preview?.uni || uni, role, actor_role, view_as: preview, term_id, read_only: !!preview || data.terms.find(t => t.id === term_id)?.status !== 'active' };
  };
  const read = term => termData(readAll(), access(), term);
  const save = data => saveAll(mergeTerm(readAll(), data, access().term_id));
  const requireRole = (admin = false) => {
    const a = access();
    if (!a || a.role === 'unlisted' || (admin && a.role !== 'instructor')) throw new Error('You do not have access to this material.');
    return a;
  };
  const visible = row => { const a = requireRole(); return (a.role !== 'auditor' || row.auditor_visible) && (!('storage_path' in row) || ['instructor','grader'].includes(a.role) || row.released || (row.release_at && new Date(row.release_at).getTime() <= Date.now())); };
  return {
    ...extendTerms({ readAll, saveAll, access }),
    ...extendPrep({ readAll, saveAll, access }),
    ...extendProfiles({ readAll, saveAll, access }),
    ...extendAssignments({ read, save, access }),
    ...extendDemo({ read, save, user, access, saveUser: u => sessionStorage.setItem(SESSION, JSON.stringify(u)) }),
    ...extendSubmissions({ read, save, access, allTerms: () => readAll().terms }),
    demo: true,
    async sessions() { requireRole(); return read().sessions; },
    async announcements() { requireRole(); return (read().announcements || []).sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)); },
    async saveAnnouncement(row) {
      requireRole(true);
      const values = announcementText(row), d = read();
      d.announcements ||= [];
      if (row.id) {
        const current = d.announcements.find(a => a.id === row.id);
        if (!current) throw new Error('Announcement not found.');
        Object.assign(current, values);
      } else d.announcements.push({ ...values, id: crypto.randomUUID(), created_at: new Date().toISOString() });
      save(d);
    },
    async deleteAnnouncement(id) { requireRole(true); const d = read(); d.announcements = (d.announcements || []).filter(a => a.id !== id); save(d); },
    async getAccess() { return access(); },
    async pickRole(role) {
      const email = { instructor: OWNER, grader: 'grader@columbia.edu', student: 'ab1234@columbia.edu', auditor: 'auditor@columbia.edu', unlisted: 'zz9999@columbia.edu', gsb: 'demo@gsb.columbia.edu', test: 'teststudent@example.test' }[role];
      if (!email) throw new Error('Choose a demo role.');
      sessionStorage.setItem(SESSION, JSON.stringify({ email, uni: role === 'test' ? 'test1' : extractUni(email) })); return access();
    },
    async signOut() { sessionStorage.removeItem(SESSION); },
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
      requireRole(true);
      const category = fields.category ?? 'notes';
      if (!['in_class', 'notes'].includes(category)) throw new Error('Choose In-class files or Lecture notes.');
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
      const d = read(); const id = crypto.randomUUID(); d.files.push({ id, ...fields, category, file_size: file.size, storage_path: `${id}.pdf`, created_at: new Date().toISOString(), data }); save(d);
    },
    async setFileRelease(id, released, release_at = null) { requireRole(true); const d = read(); Object.assign(d.files.find(f => f.id === id), { released, release_at }); save(d); },
    async setFileVisibility(id, value) { requireRole(true); const d = read(); d.files = d.files.map(f => f.id === id ? { ...f, auditor_visible: value } : f); save(d); },
    async deleteFile(id) { requireRole(true); const d = read(); d.files = d.files.filter(f => f.id !== id); save(d); },
    async fileUrl(id) { const file = read().files.find(f => f.id === id); if (!file || !visible(file)) throw new Error('File unavailable.'); const blob = await (await fetch(file.data)).blob(); const url = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(url), 300000); return url; },
  };
}
