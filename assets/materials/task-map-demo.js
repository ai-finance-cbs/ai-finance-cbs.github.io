import {validateTaskMap, taskMapClosed} from './task-map-core.js';
import {termData} from './submission-demo.js';
export function extendTaskMaps({readAll, saveAll, access}) {
  function context(term, roles) {
    const a = access(), all = readAll();
    if (!roles.includes(a?.role) || (a?.view_as && a.term_id !== term)) throw new Error('Access required for this term.');
    const d = termData(all, a, term);
    return {a, all, d};
  }
  return {
    async myTaskMap(term) {
      const {a, all, d} = context(term, ['student']);
      return {submission:(all.task_maps || []).find(r => r.term_id === term && r.uni === a.uni) || null,
        due_at:d.items.find(i => i.code === 'M2')?.due_at || null,
        read_only:!!a.view_as || all.terms.find(t => t.id === term)?.status !== 'active'};
    },
    async saveTaskMap(term, payload, submit) {
      const {a, all, d} = context(term, ['student']);
      if (a.view_as || all.terms.find(t => t.id === term)?.status !== 'active') throw new Error('Archived term and preview are read-only.');
      if (typeof submit !== 'boolean') throw new Error('Choose draft or submit.');
      validateTaskMap(payload, submit);
      if (taskMapClosed(d.items.find(i => i.code === 'M2')?.due_at)) throw new Error('Submissions closed or deadline unavailable.');
      const now = new Date().toISOString();
      const row = {...structuredClone({job:payload.job,tasks:payload.tasks,look_ahead:payload.look_ahead,ai_use:payload.ai_use}),
        term_id:term, uni:a.uni, status:submit ? 'submitted' : 'draft', submitted_at:submit ? now : null, updated_at:now};
      all.task_maps = (all.task_maps || []).filter(r => r.term_id !== term || r.uni !== a.uni);
      all.task_maps.push(row); saveAll(all); return structuredClone(row);
    },
    async taskMapClass(term) {
      const {all, d} = context(term, ['instructor','grader']);
      const roster = d.roster.filter(r => !all.allowlist.some(a => ['instructor','grader','auditor'].includes(a.role) &&
        (a.email === `${r.uni}@columbia.edu` || all.student_accounts.some(s => s.email === a.email && s.uni === r.uni))));
      if (all.terms.find(t => t.id === term)?.status === 'active') for (const t of all.test_accounts || [])
        if (t.role === 'student' && t.uni && !roster.some(r => r.uni === t.uni)) roster.push({uni:t.uni,name:`Test student ${t.uni}`});
      const rows = (all.task_maps || []).filter(r => r.term_id === term);
      return {students:roster.map(r => ({uni:r.uni,name:r.name,submission:rows.find(s => s.uni === r.uni) || null})),
        unrostered:rows.filter(s => !roster.some(r => r.uni === s.uni)).map(s => ({uni:s.uni,name:s.uni,submission:s}))};
    },
  };
}
