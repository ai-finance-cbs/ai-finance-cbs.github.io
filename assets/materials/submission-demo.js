import { canWrite, gradeCode, scoreValue } from './class-core.js';
import { checkSubmissionFile, submissionContentType, defaultSubmissionItem, safeSubmission } from './submission-core.js';
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
export function refreshDemoLocks(d,items) {
  for(const s of d.submissions.filter(s=>items.includes(s.item_id))) s.graded_at=d.grades.some(g=>g.item_id===s.item_id && s.member_unis.includes(g.uni)) ? s.graded_at || new Date().toISOString() : null;
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
  const target=(d,id,kind)=>{
    const a=requireRole(['student']), i=d.items.find(i=>i.id===id);
    if(!i || i.kind!==kind) throw new Error('This item does not accept this submission type.');
    const group=i.mode==='group' ? d.members.find(m=>m.set_id===i.group_set_id && m.uni===a.uni)?.group_id : null;
    if(i.mode==='group' && !group) {const e=new Error('Join a group first.'); e.code='P0002'; throw e;}
    const owner=group ? null : a.uni;
    const prior=d.submissions.find(s=>s.item_id===id && (group ? s.group_id===group : s.owner_uni===owner));
    if(demoSubmissionLocked(d,id,owner,group)) throw new Error('Graded, locked.');
    return {i,group,owner,prior};
  };
  const store=(d,id,kind,values)=>{
    const {i,group,owner,prior}=target(d,id,kind);
    const late=!!i.due_at && (new Date(values.started_at)>new Date(i.due_at) || (!!values.object_created_at && new Date(values.object_created_at).getTime()>new Date(i.due_at).getTime()+300000));
    const keep=late && prior ? (prior.late ? {on_time_path:prior.on_time_path,on_time_link:prior.on_time_link,on_time_data:prior.on_time_data,on_time_started_at:prior.on_time_started_at,on_time_submitted_at:prior.on_time_submitted_at} :
      {on_time_path:prior.storage_path,on_time_link:prior.link,on_time_data:prior.data,on_time_started_at:prior.started_at,on_time_submitted_at:prior.submitted_at}) : {};
    const row={id:prior?.id || crypto.randomUUID(),term_id:d.term_id,item_id:id,owner_uni:owner,group_id:group,
      storage_path:null,link:null,on_time_path:null,on_time_link:null,on_time_started_at:null,on_time_submitted_at:null,graded_at:null,
      submitted_at:new Date().toISOString(),submitted_by:access().uni,member_unis:group ? d.members.filter(m=>m.group_id===group && (d.roster.some(r=>r.uni===m.uni && !d.allowlist.some(a=>a.email===`${r.uni}@columbia.edu`)) || d.test_accounts.some(a=>a.role==='student' && a.uni===m.uni))).map(m=>m.uni).sort() : [owner],late,...values,...keep};
    d.submissions=d.submissions.filter(s=>s.id!==row.id);d.submissions.push(row);return {submission:safeSubmission(row)};
  };
  return {
    async terms() { const a=access(); return allTerms().filter(t=>{try {read(t.id);return true;} catch{return false;}}).map(t=>({...t})); },
    async setSessionTimes(week,starts_at,ends_at) {
      requireRole(['instructor']);if(starts_at && ends_at && new Date(ends_at)<=new Date(starts_at)) throw new Error('End must follow start.');
      const d=read(),s=d.sessions.find(s=>s.week===week);if(!s)throw new Error('Invalid session.');
      Object.assign(s,{starts_at,ends_at});if(starts_at)s.date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(starts_at));save(d);
    },
    async configureItem(id,fields) {
      requireRole(['instructor']); const d=read(),i=d.items.find(i=>i.id===id);if(!i)throw new Error('Invalid item.');
      if(!['file','link','none'].includes(fields.kind) || !['individual','group'].includes(fields.mode) || (fields.group_set_id && (fields.mode!=='group' || !d.sets.some(s=>s.id===fields.group_set_id))))throw new Error('Invalid item settings.');
      if(d.submissions.some(s=>s.item_id===id) && ['kind','mode','group_set_id'].some(k=>i[k]!==fields[k]))throw new Error('Submission mode cannot change after work has been submitted.');
      if(fields.mode==='group' && !fields.group_set_id)throw new Error('Choose a group set for group submissions.');
      Object.assign(i,fields);save(d);
    },
    async beginSubmission(id,file) {
      const d=read(),{owner,group}=target(d,id,'file');
      const ext=file.name.split('.').at(-1).toLowerCase();
      const type=submissionContentType(file);
      if(!file.size || file.size>25*1024*1024 || file.name.length>240 || /[/\\]/.test(file.name))throw new Error('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
      d.pending_uploads=d.pending_uploads.filter(p=>p.item_id!==id || (group ? p.group_id!==group : p.owner_uni!==owner));
      const p={id:crypto.randomUUID(),term_id:d.term_id,item_id:id,owner_uni:owner,group_id:group,uploader:access().uni,storage_path:`${d.term_id}/${id}/${group || owner}/${crypto.randomUUID()}.${ext}`,file_name:file.name,file_size:file.size,mime_type:type,started_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()};
      d.pending_uploads.push(p);save(d);return p;
    },
    async uploadSubmissionFile(pending,file,onProgress) {
      requireRole(['student']);await checkSubmissionFile(file);
      // Delay only the progress-enabled UI path. Direct setup calls remain fast.
      if (onProgress) for (const percent of [0,24,62,88,100]) { onProgress(percent); await new Promise(resolve=>setTimeout(resolve,120)); }
      requireRole(['student']);const d=read(),p=d.pending_uploads.find(p=>p.id===pending.id && p.uploader===access().uni);
      if(!p || new Date(p.expires_at)<=new Date())throw new Error('Pending upload expired or superseded.');
      if(file.size!==p.file_size || submissionContentType(file)!==p.mime_type)throw new Error('File metadata does not match.');
      p.object_created_at=new Date().toISOString();
      p.data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});save(d);
    },
    async finishSubmission(id) {
      requireRole(['student']);const d=read(),p=d.pending_uploads.find(p=>p.id===id && p.uploader===access().uni);
      if(!p || new Date(p.expires_at)<=new Date())throw new Error('Pending upload expired or superseded.');
      const o=target(d,p.item_id,'file'); if(p.owner_uni!==o.owner || p.group_id!==o.group)throw new Error('Group membership changed. Start again.');
      if(!p.data)throw new Error('Upload the file before finishing.');
      const result=store(d,p.item_id,'file',{storage_path:p.storage_path,file_name:p.file_name,file_size:p.file_size,started_at:p.started_at,object_created_at:p.object_created_at,data:p.data});
      d.pending_uploads=d.pending_uploads.filter(x=>x.id!==id);save(d);return result;
    },
    async submitFile(id,file,onProgress) {await checkSubmissionFile(file);const p=await this.beginSubmission(id,file);await this.uploadSubmissionFile(p,file,onProgress);return this.finishSubmission(p.id);},
    async deleteSubmission(id) {
      requireRole(['student']);const d=read(),s=d.submissions.find(s=>s.id===id);
      if(!s)throw new Error('Submission unavailable.');
      const i=d.items.find(i=>i.id===s.item_id),o=target(d,s.item_id,i?.kind);
      if(s.owner_uni!==o.owner || s.group_id!==o.group)throw new Error('Submission access required.');
      if(s.group_id && s.submitted_by!==access().uni)throw new Error('Only the member who uploaded this file can delete it. You can replace it.');
      if(i.due_at && Date.now()>=new Date(i.due_at).getTime())throw new Error('The deadline has passed. This submission cannot be deleted.');
      d.submissions=d.submissions.filter(row=>row.id!==id);
      d.pending_uploads=d.pending_uploads.filter(p=>p.item_id!==s.item_id || (s.group_id ? p.group_id!==s.group_id : p.owner_uni!==s.owner_uni));
      save(d);return {deleted:true,cleanup_pending:false};
    },
    async submitLink(id,link) {
      requireRole(['student']);if(link.length>2000 || !/^https:\/\/[^/\s?#]+[^\s]*$/.test(link))throw new Error('Use a valid https:// video link.');
      const d=read(),result=store(d,id,'link',{link,started_at:new Date().toISOString()});save(d);return result;
    },
    async submissionUrl(id,version='current') {
      const a=access(),d=read(),s=d.submissions.find(s=>s.id===id);
      if(!s || a.role==='auditor' || !(['instructor','grader'].includes(a.role) || s.owner_uni===a.uni || d.members.some(m=>m.group_id===s.group_id && m.uni===a.uni)))throw new Error('Submission unavailable.');
      const data=version==='on-time'?s.on_time_data:s.data;if(!data)throw new Error('File unavailable.');
      const url=URL.createObjectURL(await (await fetch(data)).blob());setTimeout(()=>URL.revokeObjectURL(url),300000);return url;
    },
    async sweepSubmissions() {requireRole(['instructor']);const d=read(),before=d.pending_uploads.length;d.pending_uploads=d.pending_uploads.filter(p=>new Date(p.expires_at)>new Date());save(d);return {removed:before-d.pending_uploads.length};},
    async gradeGroup(id,group,score,comment=null) {
      requireRole(['instructor','grader']);const d=read(),i=d.items.find(i=>i.id===id),s=d.submissions.find(s=>s.item_id===id && s.group_id===group);
      if(!i || i.mode!=='group' || !d.groups.some(g=>g.id===group && g.set_id===i.group_set_id))throw new Error('Group does not belong to this item set.');
      if(!s)throw new Error('No submitted work for this group.');
      if(comment?.length>10000)throw new Error('Comment is too long.');
      const value=score==null?null:scoreValue(score,i.max_points);
      for(const uni of s.member_unis){d.grades=d.grades.filter(g=>g.item_id!==id || g.uni!==uni);if(value!=null)d.grades.push({uni,item_id:id,score:value,comment});}
      d.group_grades=d.group_grades.filter(g=>g.item_id!==id || g.group_id!==group);
      d.group_grades.push({item_id:id,group_id:group,score:value,comment});
      refreshDemoLocks(d,[id]);save(d);
    },
  };
}
