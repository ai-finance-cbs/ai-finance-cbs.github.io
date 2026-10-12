import {validateGroupLink,groupLinkHint,groupLinkClosed,GROUP_NOT_SET_UP,GROUP_NOT_JOINED} from './group-link-core.js';
import {trackPreparationEditor} from './prep-ui.js';
const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const date=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'';
function linkNode(value) {
  const n=el('a',value);n.target='_blank';n.rel='noopener noreferrer';
  try{n.href=validateGroupLink(value);}catch{n.removeAttribute('href');}
  return n;
}
function studentView(root,ctx,result) {
  if(!result.setup){root.append(el('p',GROUP_NOT_SET_UP,'group-link-warning'));return;}
  if(!result.available){root.append(el('p','Canvas group data unavailable. Please contact the teaching team.','group-link-warning'));return;}
  if(!result.group){root.append(el('p',GROUP_NOT_JOINED,'group-link-warning'));return;}
  const form=el('form','','group-link-editor');form.noValidate=true;form.setAttribute('aria-label','Group website link');
  const status=el('div','','task-map-status in-panel-head group-link-status'),pill=el('span','','task-map-state'),saving=el('span');
  status.setAttribute('role','status');status.append(pill,saving);root.querySelector(':scope > .assignment-panel-head').append(status);
  form.append(el('p',`${result.group.name} · ${result.group.members.map(m=>m.name).join(', ')}`,'group-link-members'));
  const label=el('label','Live website link','group-link-field'),input=el('input');input.type='url';input.inputMode='url';input.maxLength=2000;input.autocomplete='url';input.value=result.submission?.link || '';label.append(input);
  const hint=el('p','','group-link-hint'),warning=el('p','','group-link-warning'),storedLine=el('div','','group-link-submitted'),message=el('p','','group-link-message');message.setAttribute('role','status');
  const submit=el('button','Submit','materials-button');submit.type='submit';
  form.append(label,hint,warning,submit,storedLine,message);root.append(form);
  let stored=result.submission,busy=false,justSaved=false;
  const permanentLock=!!(result.read_only || ctx.access.view_as || ctx.access.read_only);
  const locked=()=>permanentLock || result.closed || groupLinkClosed(result.due_at);
  const dirty=()=>input.value!==(stored?.link || '');
  function update() {
    pill.textContent=stored?'Submitted':'Not submitted';saving.textContent=busy?'Saving…':justSaved?'Saved!':dirty()?'Unsaved changes':'';
    hint.textContent=groupLinkHint(input.value);input.disabled=busy || locked();submit.disabled=busy || locked();submit.hidden=locked();
    warning.textContent=permanentLock?'Read-only view':!result.due_at?'Canvas M3 deadline unavailable. Please contact the teaching team.':locked()?`Submissions closed ${date(result.due_at)}`:'';
    storedLine.replaceChildren();
    if(stored)storedLine.append(el('p',`Submitted by ${stored.submitted_by_name}, ${date(stored.submitted_at)}`),linkNode(stored.link));
    else storedLine.append(el('p','Your group has not submitted yet.'));
  }
  input.addEventListener('input',()=>{justSaved=false;message.textContent='';update();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy || locked()){update();return;}
    try {
      const link=validateGroupLink(input.value);busy=true;justSaved=false;message.textContent='';update();
      stored=await ctx.backend.saveGroupLink(ctx.data.term_id,'M3',link);input.value=stored.link;justSaved=true;
    }catch(error){message.textContent=error.message;}finally{busy=false;update();}
  });
  update();if(!permanentLock)trackPreparationEditor(form,()=>busy || dirty());
  function schedule(){if(!form.isConnected || locked())return;
    setTimeout(()=>{if(form.isConnected){update();schedule();}},Math.min(2147483647,Math.max(1,Date.parse(result.due_at)-Date.now())));}
  schedule();
}
function staffView(root,result) {
  if(!result.setup){root.append(el('p',GROUP_NOT_SET_UP,'group-link-warning'));return;}
  const body=el('div','','group-link-staff');
  body.append(el('p',`${result.groups.filter(g=>g.submission).length} of ${result.groups.length} groups submitted`,'group-link-counts'));
  const table=el('table','','group-link-table'),head=el('thead'),hr=el('tr'),rows=el('tbody');table.setAttribute('aria-label','M3 group submissions');
  const labels=['Group','Members','Link','Submitted by','Time (ET)','Late'];
  for(const title of labels){const th=el('th',title);th.scope='col';hr.append(th);}head.append(hr);
  for(const g of result.groups){const tr=el('tr'),s=g.submission;
    const values=[g.name,g.members.map(m=>m.name).join(', '),s?linkNode(s.link):'Missing',s?.submitted_by_name || '—',date(s?.submitted_at) || '—',s?(g.late===null?'Unknown':g.late?'Late':'On time'):'—'];
    values.forEach((value,i)=>{const cell=el(i===0?'th':'td');if(i===0)cell.scope='row';cell.dataset.label=labels[i];cell.append(value);tr.append(cell);});rows.append(tr);
  }
  table.append(head,rows);body.append(table);root.append(body);
}
export async function renderGroupLink(root,ctx) {
  if(!['student','instructor','grader'].includes(ctx.access.role))return;
  const loading=el('p','Loading group submission…','group-link-hint');root.append(loading);
  try{
    const staff=['instructor','grader'].includes(ctx.access.role);
    const result=await(staff?ctx.backend.groupLinkClass(ctx.data.term_id,'M3'):ctx.backend.myGroupLink(ctx.data.term_id,'M3'));
    if(!root.isConnected)return;loading.remove();if(staff)staffView(root,result);else studentView(root,ctx,result);
  }catch(error){loading.textContent=`Group submission unavailable: ${error.message}`;loading.setAttribute('role','alert');}
}
