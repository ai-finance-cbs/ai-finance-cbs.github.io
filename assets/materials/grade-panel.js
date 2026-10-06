import { gradeCode } from './class-core.js';
import { courseTime, submissionStatus } from './week-core.js';
import { gradingSubmission } from './staff-core.js';

const el = (tag, text, attrs = {}) => {
  const n = document.createElement(tag); if (text != null) n.textContent = text;
  for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); return n;
};
export function renderGradePanel({panel, data, item, student, backend, close}) {
  panel.replaceChildren(); panel.hidden = false;
  const title = el('h2', `${gradeCode(item)} · ${student.name || student.uni}`, {id:'grade-panel-title'});
  const status = el('p', '', {role:'status','data-panel-status':''});
  const action = (text, task) => {
    const b=el('button',text,{type:'button',class:'materials-button'});
    b.addEventListener('click',async()=>{b.disabled=true;status.textContent='';try{await task();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}});return b;
  };
  panel.append(action('Close panel',close),title);
  const submission=gradingSubmission(data,item,student.uni);
  panel.append(el('p',submissionStatus(submission),{'data-panel-submission':''}));
  const download=(text,version)=>action(text,async()=>{
    const url=await backend.submissionUrl(submission.id,version);
    const link=el('a',null,{href:url,download:submission.file_name || 'submission',rel:'noopener noreferrer'});link.click();
  });
  if(submission) {
    if(submission.storage_path) panel.append(download(submission.file_name || 'Download file','current'));
    if(submission.link) panel.append(el('a','Open submission',{href:submission.link,target:'_blank',rel:'noopener noreferrer'}));
    panel.append(el('p',`Started ${courseTime(submission.started_at)}`),el('p',`Submitted ${courseTime(submission.submitted_at)}`));
    if(submission.on_time_path || submission.on_time_link) {
      panel.append(el('h3','Last on-time submission'));
      if(submission.on_time_path) panel.append(download('Download last on-time file','on-time'));
      if(submission.on_time_link) panel.append(el('a','Open last on-time link',{href:submission.on_time_link,target:'_blank',rel:'noopener noreferrer'}));
      panel.append(el('p',`Started ${courseTime(submission.on_time_started_at)}`),el('p',`Submitted ${courseTime(submission.on_time_submitted_at)}`));
    }
    if(submission.group_id) {
      panel.append(el('h3','Members at submission'));
      const list=el('ul');
      for(const uni of submission.member_unis) {
        const member=data.roster.find(r=>r.uni===uni);
        const current=data.members.find(m=>m.set_id===item.group_set_id && m.uni===uni);
        const group=data.groups.find(g=>g.id===current?.group_id);
        const moved=current?.group_id!==submission.group_id;
        list.append(el('li',`${member?.name || uni} (${uni})${moved ? ` · Now ${group ? `Group ${group.number}` : 'without a group'}` : ''}`));
      }
      panel.append(list);
      const added=data.members.filter(m=>m.group_id===submission.group_id && !submission.member_unis.includes(m.uni));
      if(added.length) panel.append(el('p',`Joined later; not in this grade: ${added.map(m=>data.roster.find(r=>r.uni===m.uni)?.name || m.uni).join(', ')}.`));
    }
  }
  const grade=data.grades.find(g=>g.uni===student.uni && g.item_id===item.id);
  panel.append(el('p', item.released ? 'Visible to students now.' : 'Hidden from students.', {
    class:'grade-visibility-note', 'data-panel-visibility':item.released ? 'visible' : 'hidden',
  }), el('p', `Score: ${grade?.score ?? 'Not graded'} / ${item.max_points}`, {'data-archived-score':''}),
    el('p', grade?.comment || 'No comment.', {'data-archived-comment':''}), status);
}
