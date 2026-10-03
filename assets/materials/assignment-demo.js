import { ASSIGNMENT_CODES, assignmentBody } from './assignment-core.js';

export function extendAssignments({ read, save, access }) {
  const allowed = (d, i) => ASSIGNMENT_CODES.includes(i.code) && (access().role !== 'auditor' ||
    (i.code.startsWith('O') ? i.auditor_visible : d.assignments.some(a => a.id === (i.code === 'FP' ? 6 : Number(i.code[1])) && a.auditor_visible)));
  return {
    async assignmentCatalog(term) {
      const d = read(term);
      return d.items.filter(i => allowed(d,i)).map(({ id,code,title,kind,mode,due_at }) => ({ id,code,kind,mode,due_at,
        title:d.assignments.find(a => a.id === (code === 'FP' ? 6 : /^M[1-5]$/.test(code) ? Number(code[1]) : null))?.title || title }));
    },
    async assignmentPages(term, codes) {
      const d = read(term);
      return d.assignment_pages.filter(p => codes.includes(p.code) && d.items.some(i => i.code === p.code && allowed(d,i)));
    },
    async saveAssignmentPage(term, code, body) {
      const a = access(), d = read(term);
      if (a.role !== 'instructor' || a.view_as || d.terms.find(t => t.id === term)?.status !== 'active') throw new Error('Instructor access required. Archived terms and preview are read-only.');
      assignmentBody(code, body);
      if (!d.items.some(i => i.code === code)) throw new Error('Assignment not found.');
      const row = { term_id:term,code,body_md:body,updated_at:new Date().toISOString() };
      d.assignment_pages = d.assignment_pages.filter(p => p.code !== code); d.assignment_pages.push(row); save(d); return row;
    },
  };
}
