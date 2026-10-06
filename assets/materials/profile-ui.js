import { gradeCode, gradeTotal, canWrite } from './class-core.js';
import { gradingSubmission } from './staff-core.js';
import { courseTime, submissionStatus } from './week-core.js';
import { renderGradePanel } from './grade-panel.js';
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const button=(text,action)=>{const n=el('button',text,{type:'button',class:'materials-button'});n.onclick=action;return n;};
let profileKeys=null;

export function installStudentProfiles({root,data,access,backend,openGrade,onOpen=()=>{}}) {
  if(profileKeys)document.removeEventListener('keydown',profileKeys);
  if (access.view_as || !['instructor','grader'].includes(access.role)) return;
  let workspace=root.querySelector('.gradebook-workspace');
  if (!workspace) {
    workspace=el('div',null,{class:'gradebook-workspace'});
    const content=el('div',null,{class:'gradebook-content'});
    content.append(...root.childNodes);workspace.append(content);root.append(workspace);
  }
  let panel=workspace.querySelector('.grade-panel');
  if (!panel) {panel=el('aside',null,{class:'grade-panel'});panel.hidden=true;workspace.append(panel);}
  let opener;
  const drafts=new Map();
  const close=()=>{panel.hidden=true;delete panel.dataset.profileUni;workspace.classList.remove('panel-open');opener?.focus({preventScroll:true});};
  function showGrade(item,student) {
    delete panel.dataset.profileUni;panel.setAttribute('aria-labelledby','grade-panel-title');
    if(openGrade)openGrade(item,student);
    else renderGradePanel({panel,data,item,student,backend,role:access.role,readOnly:true,close:()=>open(student.uni),
      save:async()=>{throw new Error('Use CourseWorks. Local grades are read-only archives.');},
    });
    panel.append(button('Back to student card',()=>open(student.uni)));
    const heading=panel.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});
  }
  function open(uni) {
    const student=data.roster.find(r=>r.uni===uni);if(!student)return;
    onOpen();panel.replaceChildren();panel.hidden=false;panel.dataset.profileUni=uni;
    panel.setAttribute('aria-labelledby','student-profile-title');workspace.classList.add('panel-open');
    panel.scrollTop=0;
    const card=el('div',null,{class:'student-card'}),band=el('div',null,{class:'band'});
    band.append(el('span',`B8403 · ${data.term_id.replaceAll('-',' ')}`),el('span','Student'));
    const main=el('div',null,{class:'main'}),identity=el('div',null,{class:'identity'});
    const words=(student.name || uni).trim().split(/\s+/),initials=(words[0][0]+(words.length>1?words.at(-1)[0]:'')).toUpperCase();
    const photo=el('div',initials,{class:'photo','aria-hidden':'true'});
    const title=el('h2',student.name || uni,{class:'name',id:'student-profile-title',tabindex:'-1'});
    identity.append(title,el('div',uni,{class:'meta student-uni'}));
    panel.append(button('Close student card',close),card);
    const email=el('div','Loading email…',{class:'meta'});identity.append(email);
    backend.studentProfile(data.term_id,uni).then(row=>{
      email.replaceChildren(row?.email ? el('a',row.email,{href:`mailto:${row.email}`}) : 'No email');
    }).catch(()=>{email.textContent='Email unavailable.';});
    const groups=data.members.filter(m=>m.uni===uni).map(m=>`${data.sets.find(s=>s.id===m.set_id)?.title}: Group ${data.groups.find(g=>g.id===m.group_id)?.number}`);
    const grades=data.grades.filter(g=>g.uni===uni);
    const totals=el('div',null,{class:'meta totals'});
    totals.append('Archived site total ',el('strong',gradeTotal(data.items.filter(i=>i.released),grades).total,{'data-profile-visible-total':''}),' visible · ',el('span',`${gradeTotal(data.items,grades).total} incl. hidden`,{'data-profile-all-total':''}));
    identity.append(el('div',groups.join(' · ') || 'No group',{class:'meta'}),totals);main.append(photo,identity);
    const attendance=el('ul',null,{class:'stamps profile-attendance','aria-label':'Attendance'});
    for(let week=1;week<=6;week++) {
      const state=data.attendance.find(a=>a.uni===uni && a.week===week)?.status || 'unrecorded';
      const label=`Week ${week}: ${state==='unrecorded'?'Not recorded':state}`;
      attendance.append(el('li',`W${week}`,{class:`stamp ${state}`,title:label,'aria-label':label}));
    }
    const foot=el('div',null,{class:'foot'}),chips=el('div',null,{class:'work-chips','aria-label':'Work'});
    for(const item of data.items) {
      const grade=grades.find(g=>g.item_id===item.id),submission=gradingSubmission(data,item,uni),code=gradeCode(item);
      const state=grade?.score!=null ? (item.released?'ok':'hid') : submission?.late?'late':submission?'ok':'miss';
      const text=grade?.score!=null ? (item.released?`${grade.score}/${item.max_points}`:'hidden') : submission?.late?'late':submission?'submitted':'—';
      const chip=el('button',`${code} ${text}`,{type:'button',class:`chip ${state}`,'data-profile-chip':code,
        'aria-label':`Open ${code} grade panel: ${item.released?'Visible':'Hidden'}, ${grade?.score ?? 'Ungraded'} of ${item.max_points}${submission?`, ${submissionStatus(submission)}`:''}`,title:item.title});
      chip.onclick=()=>showGrade(item,student);chips.append(chip);
    }
    foot.append(el('p','Archived site work',{class:'upcoming-meta'}),chips);card.append(band,main,attendance,el('div',null,{class:'barcode','aria-hidden':'true'}),foot);
    for (const a of data.attendance.filter(a => a.uni === uni && a.status === 'excused' && a.excuse_reason))
      panel.append(el('p', `Week ${a.week} excused: ${a.excuse_reason}`, { class: 'profile-excuse-reason' }));
    // Keep the full record available without crowding the ID-card summary.
    const record=el('details',null,{class:'profile-record'});record.append(el('summary','Archived submissions and scores'),el('h3','Submissions'));
    for(const item of data.items.filter(i=>['file','link'].includes(i.kind))) {
      const submission=gradingSubmission(data,item,uni),row=el('section',null,{class:'profile-item','data-profile-submission':gradeCode(item)});
      row.append(el('h4',`${gradeCode(item)} · ${item.title}`),el('p',submissionStatus(submission)));
      if(submission) {
        row.append(el('p',courseTime(submission.submitted_at)));
        if(submission.link) {
          const link=new URL(submission.link);
          if(link.protocol==='https:')row.append(el('a','Open submitted link',{href:link.href,target:'_blank',rel:'noopener noreferrer'}));
        } else {
          const status=el('span','',{role:'status'});
          const download=button(submission.file_name || 'Download file',async()=>{
            download.disabled=true;status.textContent='';
            try {const url=await backend.submissionUrl(submission.id);const a=el('a',null,{href:url,download:submission.file_name || 'submission',rel:'noopener noreferrer'});a.click();}
            catch(e){status.textContent=e.message;}finally{download.disabled=false;}
          });row.append(download,status);
        }
      }
      record.append(row);
    }
    record.append(el('h3','Scores'));
    for(const item of data.items) {
      const grade=grades.find(g=>g.item_id===item.id),row=el('section',null,{class:'profile-item','data-profile-score':gradeCode(item)});
      row.append(el('h4',`${gradeCode(item)} · ${item.title}`),el('span',item.released?'Visible':'Hidden',{class:'grade-visibility','data-release-state':item.released?'visible':'hidden'}),el('p',`${grade?.score ?? 'Ungraded'} / ${item.max_points}`));
      if(grade?.comment)row.append(el('p',grade.comment,{class:'grade-comment'}));record.append(row);
    }
    if(access.role==='instructor') {
      const form=el('form',null,{class:'admin-form profile-note note'}),label=el('label','Private instructor note');
      const note=el('textarea',null,{'aria-label':'Private instructor note',maxlength:'10000',rows:'3'});
      note.disabled=true;label.append(note);const status=el('p','Loading note…',{role:'status'});
      const save=button('Save note',()=>{});save.type='submit';save.disabled=true;form.append(label,save,status);foot.append(form);
      const savedText=row=>row.updated_at?`Saved ${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(row.updated_at))}`:'';
      backend.studentNote(data.term_id,uni).then(row=>{
        note.value=drafts.get(uni) ?? row.body;note.disabled=!canWrite(access);save.disabled=!canWrite(access);
        status.textContent=!canWrite(access)?'Archived term · Read-only':drafts.has(uni)?'Unsaved note':savedText(row);
      }).catch(e=>{status.textContent=e.message;});
      note.oninput=()=>{drafts.set(uni,note.value);status.textContent='Unsaved note';};
      form.onsubmit=async e=>{
        e.preventDefault();if(!canWrite(access)||save.disabled)return;save.disabled=true;note.disabled=true;status.textContent='Saving…';
        try {const row=await backend.saveStudentNote(data.term_id,uni,note.value);drafts.delete(uni);status.textContent=savedText(row);}
        catch(error){status.textContent=error.message;}finally{save.disabled=false;note.disabled=false;}
      };
    }
    foot.append(record);
    title.focus({preventScroll:true});
    if(window.matchMedia('(max-width:819px)').matches)panel.scrollIntoView({block:'start',behavior:'instant'});
  }
  root.onclick=e=>{const name=e.target.closest('[data-student-profile]');if(!name)return;opener=name;open(name.dataset.studentProfile);};
  profileKeys=e=>{
    if(!panel.isConnected || panel.hidden || !panel.dataset.profileUni)return;
    if(e.key==='Escape'){e.preventDefault();close();return;}
    if(!['ArrowUp','ArrowDown'].includes(e.key) || e.target.matches('input,textarea,select'))return;
    const students=[...root.querySelectorAll('[data-student-profile]')].filter(n=>!n.closest('tr').hidden);
    const index=students.findIndex(n=>n.dataset.studentProfile===panel.dataset.profileUni);
    const next=students[index+(e.key==='ArrowUp'?-1:1)];e.preventDefault();
    if(next){opener=next;open(next.dataset.studentProfile);}
  };
  // Escape also works after saving or clicking outside the card.
  document.addEventListener('keydown',profileKeys);
}
