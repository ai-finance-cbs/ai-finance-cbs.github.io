import {validateGroupLink,groupLinkClosed,GROUP_NOT_SET_UP,GROUP_NOT_JOINED} from './group-link-core.js';
import {termData} from './submission-demo.js';
export function extendGroupLinks({readAll,saveAll,access,canvas}) {
  function context(term,code,roles) {
    const a=access(),all=readAll();
    if(code!=='M3')throw Error('Invalid group submission code.');
    if(!roles.includes(a?.role) || (a.view_as && a.term_id!==term))throw Error('Access required for this term.');
    return {a,all,d:termData(all,a,term)};
  }
  function setup(v,code) {
    const mapping=v?.mappings.find(m=>m.site_key===code);
    return v?.assignments.find(a=>String(a.id)===String(mapping?.canvas_assignment_id));
  }
  const named=(s,d)=>s?{...structuredClone(s),submitted_by_name:d.roster.find(r=>r.uni===s.submitted_by_uni)?.name || s.submitted_by_uni}:null;
  async function mine(term,code) {
    context(term,code,['student']);
    let projection;try{projection=await canvas.canvasStudentData(term);}catch{projection={available:false,groups:[],items:[]};}
    const {a,all,d}=context(term,code,['student']),v=all.canvas?.[term],assignment=setup(v,code);
    const groups=projection.groups.filter(g=>String(g.category_id)===String(assignment?.group_category_id));
    const group=groups.length===1 && v.enrollments.filter(e=>e.uni===a.uni && e.match_status==='matched').length===1?groups[0]:null;
    const due=projection.items.find(i=>i.site_key===code)?.due_at || null;
    return {setup:assignment?.group_category_id!=null,available:projection.available,group,due_at:due,
      read_only:!!a.view_as || all.terms.find(t=>t.id===term)?.status!=='active',closed:groupLinkClosed(due),
      submission:named((all.group_links || []).find(s=>s.term_id===term && s.code===code && String(s.canvas_group_id)===String(group?.id)),d)};
  }
  return {
    myGroupLink:mine,
    async saveGroupLink(term,code,link) {
      const result=await mine(term,code),{a,all,d}=context(term,code,['student']);
      if(result.read_only)throw Error('Archived terms and preview are read-only.');
      if(!result.setup)throw Error(GROUP_NOT_SET_UP);
      if(!result.available)throw Error('Canvas group data unavailable. Please contact the teaching team.');
      if(!result.group)throw Error(GROUP_NOT_JOINED);
      if(groupLinkClosed(result.due_at))throw Error('Submissions closed or Canvas M3 deadline unavailable.');
      const now=new Date().toISOString(),row={term_id:term,code,canvas_group_id:result.group.id,link:validateGroupLink(link),submitted_by_uni:a.uni,submitted_at:now,updated_at:now};
      all.group_links=(all.group_links || []).filter(s=>s.term_id!==term || s.code!==code || String(s.canvas_group_id)!==String(row.canvas_group_id));
      all.group_links.push(row);saveAll(all);return named(row,d);
    },
    async groupLinkClass(term,code) {
      context(term,code,['instructor','grader']);const v=await canvas.canvasData(term),{all,d}=context(term,code,['instructor','grader']),assignment=setup(v,code);
      return {setup:assignment?.group_category_id!=null,due_at:assignment?.due_at || null,
        groups:v.groups.filter(g=>assignment?.group_category_id!=null && String(g.category_id)===String(assignment.group_category_id)).map(g=>{
          const submission=named((all.group_links || []).find(s=>s.term_id===term && s.code===code && String(s.canvas_group_id)===String(g.id)),d);
          const user=v.enrollments.find(e=>e.uni===submission?.submitted_by_uni && e.match_status==='matched');
          const due=v.submissions.find(s=>String(s.user_id)===String(user?.user_id) && String(s.assignment_id)===String(assignment.id))?.cached_due_at;
          return {id:g.id,name:g.name,members:v.group_members.filter(m=>String(m.group_id)===String(g.id)).map(m=>({name:m.name})),submission,
            late:submission && due?Date.parse(submission.submitted_at)>=Date.parse(due):null};
        }).sort((a,b)=>a.name.localeCompare(b.name))};
    },
  };
}
