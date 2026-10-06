import { canWrite, gradeCode } from './class-core.js';
import { defaultSubmissionItem } from './submission-core.js';
const arrays=['assignment_pages','roster','assignments','sessions','attendance','attendance_audit','items','grades','sets','groups','members','files','announcements','submissions','pending_uploads','group_grades'];
export function normalizeTerms(d) {
  d.terms ||= [{id:'spring-2027',title:'Spring 2027',status:'active'}];
  const active=d.terms.find(t=>t.status==='active')?.id || 'spring-2027';
  for(const key of arrays) d[key]=(d[key] || []).map(row=>({term_id:active,...row}));
  d.items=d.items.map(i=>defaultSubmissionItem({...i,code:gradeCode(i)}));
  d.files=d.files.map(f=>({released:true,release_at:null,category:'notes',...f}));
  return d;
}
export function termData(d,a,term=a?.term_id) {
  term ||= a?.term_id;
  const t=d.terms.find(t=>t.id===term);
  const staff=['instructor','grader'].includes(a?.role);
  const test=a?.role==='student' && d.test_accounts.some(r=>r.uni===a.uni) && t?.status==='active';
  if (!t || !a || (!staff && !(a.role==='auditor' && t.status==='active') && !(a.role==='student' && t.status!=='closed' && (test || d.roster.some(r=>r.term_id===term && r.uni===a.uni))))) throw new Error('Class access required for this term.');
  const data={...d,term_id:term};
  for(const key of arrays) data[key]=d[key].filter(r=>r.term_id===term);
  data.sets=data.sets.map(s=>({...s,submission_deadline:data.items.filter(i=>i.group_set_id===s.id && i.mode==='group' && i.due_at).map(i=>i.due_at).sort()[0] || null}));
  return data;
}
export function mergeTerm(all,data,term) {
  const result={...all,...data}; delete result.term_id;
  for(const key of arrays) result[key]=[...all[key].filter(r=>r.term_id!==term),...data[key].map(r=>({...r,term_id:term}))];
  return result;
}
export function demoSubmissionLocked(d,item,owner,group) {
  return d.submissions.some(s=>s.item_id===item && (owner ? s.owner_uni===owner : s.group_id===group) && s.graded_at) ||
    d.grades.some(g=>g.item_id===item && (g.uni===owner || (group && d.members.some(m=>m.group_id===group && m.uni===g.uni))));
}
export function studentSubmissionItems(d,uni) {
  return d.items.filter(i=>i.kind!=='none').map(({id,term_id,code,title,kind,mode,group_set_id,due_at})=>({
    id,term_id,code,title,kind,mode,group_set_id,due_at,
    locked:demoSubmissionLocked(d,id,mode==='individual'?uni:null,d.members.find(m=>m.set_id===group_set_id && m.uni===uni)?.group_id),
  }));
}
export function extendSubmissions({read,save,access,allTerms}) {
  const requireRole=roles=>{ const a=access(); if(!canWrite(a) || !roles.includes(a.role)) throw new Error('Access required. Archived terms and preview are read-only.'); return a; };
  return {
    async terms() { const a=access(); return allTerms().filter(t=>{try {read(t.id);return true;} catch{return false;}}).map(t=>({...t})); },
    async setSessionTimes(week,starts_at,ends_at) {
      requireRole(['instructor']);if(starts_at && ends_at && new Date(ends_at)<=new Date(starts_at)) throw new Error('End must follow start.');
      const d=read(),s=d.sessions.find(s=>s.week===week);if(!s)throw new Error('Invalid session.');
      Object.assign(s,{starts_at,ends_at});if(starts_at)s.date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(starts_at));save(d);
    },
    async submissionUrl(id,version='current') {
      const a=access();let d,s;
      // Downloads identify a submission, so find its readable term before checking ownership.
      for (const term of allTerms()) {
        if (a?.view_as && term.id!==a.term_id) continue;
        try {const candidate=read(term.id),row=candidate.submissions.find(row=>row.id===id);if(row){d=candidate;s=row;break;}} catch { /* An unreadable term cannot supply a file. */ }
      }
      if(!s || a.role==='auditor' || !(['instructor','grader'].includes(a.role) || s.owner_uni===a.uni || d.members.some(m=>m.group_id===s.group_id && m.uni===a.uni)))throw new Error('Submission unavailable.');
      const data=version==='on-time'?s.on_time_data:s.data;if(!data)throw new Error('File unavailable.');
      const url=URL.createObjectURL(await (await fetch(data)).blob());setTimeout(()=>URL.revokeObjectURL(url),300000);return url;
    },
  };
}
