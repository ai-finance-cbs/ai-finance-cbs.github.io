import {validateSurvey,surveyClosed} from './survey-core.js';
import {termData} from './submission-demo.js';
export function extendSurveys({readAll,saveAll,access,canvas}) {
  function context(term,roles) {
    const a=access(),all=readAll();
    if (!roles.includes(a?.role) || (a.view_as && a.term_id!==term)) throw Error('Access required for this term.');
    return {a,all,d:termData(all,a,term)};
  }
  async function deadline(term) {
    // An authorized test student may have no roster or Canvas row. Show the form, but fail closed on saves.
    try { return (await canvas.canvasStudentData(term)).items.find(i=>i.site_key==='M1')?.due_at || null; }
    catch { return null; }
  }
  return {
    async mySurvey(term) {
      context(term,['student']);const due=await deadline(term),{a,all,d}=context(term,['student']);
      return {uni:a.uni,roster_name:d.roster.find(r=>r.uni===a.uni)?.name || '',
        submission:(all.surveys || []).find(r=>r.term_id===term && r.uni===a.uni) || null,due_at:due,
        read_only:!!a.view_as || all.terms.find(t=>t.id===term)?.status!=='active'};
    },
    async saveSurvey(term,payload,submit) {
      context(term,['student']);const due=await deadline(term),{a,all}=context(term,['student']);
      if (a.view_as || all.terms.find(t=>t.id===term)?.status!=='active') throw Error('Archived terms and preview are read-only.');
      if (typeof submit!=='boolean') throw Error('Choose draft or submit.'); validateSurvey(payload,submit);
      if (surveyClosed(due)) throw Error('Submissions closed or Canvas M1 deadline unavailable.');
      const now=new Date().toISOString(),row={...structuredClone({answers:payload.answers,q9:payload.q9,q10:payload.q10}),
        term_id:term,uni:a.uni,status:submit?'submitted':'draft',submitted_at:submit?now:null,updated_at:now};
      all.surveys=(all.surveys || []).filter(r=>r.term_id!==term || r.uni!==a.uni);all.surveys.push(row);saveAll(all);return structuredClone(row);
    },
    async surveyClass(term) {
      const {all,d}=context(term,['instructor','grader']);
      const roster=d.roster.filter(r=>!all.allowlist.some(a=>['instructor','grader','auditor'].includes(a.role) &&
        (a.email===`${r.uni}@columbia.edu` || all.student_accounts.some(s=>s.email===a.email && s.uni===r.uni))));
      if (all.terms.find(t=>t.id===term)?.status==='active') for (const t of all.test_accounts || [])
        if (t.role==='student' && t.uni && !roster.some(r=>r.uni===t.uni)) roster.push({uni:t.uni,name:`Test student ${t.uni}`});
      const rows=(all.surveys || []).filter(r=>r.term_id===term);
      return {students:roster.map(r=>({uni:r.uni,name:r.name,submission:rows.find(s=>s.uni===r.uni) || null})),
        unrostered:rows.filter(s=>!roster.some(r=>r.uni===s.uni)).map(s=>({uni:s.uni,name:s.uni,submission:s}))};
    },
  };
}
