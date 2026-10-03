export function extendProfiles({readAll,saveAll,access}) {
  function staff(term, instructor=false) {
    const a=access(),d=readAll();
    if (!a || a.view_as || !(instructor ? ['instructor'] : ['instructor','grader']).includes(a.role)) throw new Error('Staff access required.');
    if (!d.terms.some(t=>t.id===term)) throw new Error('Term not found.');
    return d;
  }
  return {
    async studentProfile(term,uni) {
      const d=staff(term),r=d.roster.find(r=>r.term_id===term && r.uni===uni);
      return r ? {uni:r.uni,name:r.name,email:`${uni}@columbia.edu`} : {uni,name:`Test student ${uni}`,email:null};
    },
    async studentNote(term,uni) { return (staff(term,true).student_notes || []).find(n=>n.term_id===term && n.uni===uni) || {term_id:term,uni,body:'',updated_at:null}; },
    async saveStudentNote(term,uni,body) {
      const d=staff(term,true);
      if (d.terms.find(t=>t.id===term)?.status!=='active') throw new Error('Archived terms are read-only.');
      if ([...body].length>10000) throw new Error('Note must be at most 10,000 characters.');
      if (!d.roster.some(r=>r.term_id===term && r.uni===uni) && !d.test_accounts.some(t=>t.role==='student' && t.uni===uni)) throw new Error('Student not found.');
      const row={term_id:term,uni,body,updated_at:new Date().toISOString()};
      d.student_notes=(d.student_notes || []).filter(n=>n.term_id!==term || n.uni!==uni);d.student_notes.push(row);saveAll(d);return row;
    },
  };
}
