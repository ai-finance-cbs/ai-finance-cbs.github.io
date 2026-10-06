import {CANVAS_HOST,canvasAvailable,canvasId,canvasItems,canvasStatus,canvasPresent,canvasPosted,suggestedAssignment} from './canvas-core.js';
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const button=(text,fn)=>{const b=el('button',text,{type:'button',class:'prep-text-action'});b.addEventListener('click',fn);return b;};
const time=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York'}):'—';
function health(data) {
  const date=data.course?.last_synced_at,run=data.runs[0];
  return `Last synced: ${date?time(date):'Never'} · ${run?.status || 'Not connected'}${date && Date.now()-Date.parse(date)>1800000?' · Updates delayed':''}${run?.error?` · ${run.error}`:''}`;
}
export async function renderCanvasSettings({root,backend,term,items,readOnly}) {
  const content=el('div',null,{class:'canvas-settings'}),status=el('p','Loading Canvas…',{role:'status'});root.append(content,status);
  async function draw() {
    const data=await backend.canvasData(term); if(!root.isConnected)return;
    content.replaceChildren();status.textContent='';
    content.append(el('p',health(data),{'data-canvas-health':''}));
    const form=el('form',null,{'aria-label':'Canvas course'}),label=el('label','Course ID '),input=el('input',null,{type:'text',inputmode:'numeric','aria-label':'Canvas course ID'});
    input.value=data.course?.course_id || ''; input.disabled=readOnly;label.append(input);
    const save=button('Save course',()=>{});save.type='submit';save.disabled=readOnly;
    const sync=button('Sync now',()=>run(()=>backend.syncCanvas(term),'Sync complete.'));sync.disabled=readOnly||!data.course;
    form.append(label,save,sync);content.append(form);
    form.addEventListener('submit',e=>{
      e.preventDefault();if(readOnly)return;
      let id;try{id=canvasId(input.value);}catch(error){status.textContent=error.message;return;}
      if(data.course && String(data.course.course_id)!==id) confirmCourse(id,data.course.course_id);
      else void run(()=>backend.saveCanvasCourse(term,id),'Course saved.');
    });
    const table=el('table',null,{class:'class-grid canvas-mapping'}),head=el('tr');for(const title of ['Site item','Canvas assignment',''])head.append(el('th',title,{scope:'col'}));
    const thead=el('thead'),body=el('tbody');thead.append(head);table.append(thead,body);
    for (const item of canvasItems(items)) {
      const row=el('tr'),name=el('td',`${item.site_key} · ${item.title}`),choice=el('td'),select=el('select',null,{'aria-label':`Canvas assignment for ${item.site_key}`});
      select.append(el('option','Not mapped',{value:''}));
      for(const assignment of data.assignments)select.append(el('option',`${assignment.name} (${assignment.id})`,{value:assignment.id}));
      const mapping=data.mappings.find(m=>m.site_key===item.site_key);
      if(mapping && !data.assignments.some(a=>String(a.id)===String(mapping.canvas_assignment_id)))select.append(el('option',`Unavailable assignment (${mapping.canvas_assignment_id})`,{value:mapping.canvas_assignment_id}));
      select.value=mapping?.canvas_assignment_id || '';select.disabled=readOnly;choice.append(select);
      const suggestion=!mapping && suggestedAssignment(item,data.assignments);
      if(suggestion)choice.append(el('small',`Suggested: ${suggestion.name} (${suggestion.id}). Select it to apply.`));
      const actions=el('td'),saveMap=button('Save mapping',()=>run(()=>backend.saveCanvasMapping(term,{...item,canvas_assignment_id:select.value}),'Mapping saved.'));
      saveMap.setAttribute('aria-label',`Save mapping for ${item.site_key}`);saveMap.disabled=readOnly||!data.course;actions.append(saveMap);row.append(name,choice,actions);body.append(row);
    }
    const wrap=el('div',null,{class:'class-grid-wrap',tabindex:'0','aria-label':'Scrollable Canvas mappings'});wrap.append(table);content.append(wrap);
    const unmatched=data.enrollments.filter(e=>e.match_status!=='matched');
    content.append(el('h3',`Unmatched enrollments (${unmatched.length})`));
    for(const e of unmatched)content.append(el('p',`${e.name} · ${e.login_id || 'No login ID'} · ${e.match_status}`));
    content.append(el('p','Canvas enrollment matching does not grant site access. Fix the roster or verified account link in Settings.'));
  }
  function confirmCourse(id,previous) {
    const dialog=el('dialog',null,{class:'attendance-confirm','aria-label':'Change Canvas course'});
    const actions=el('div',null,{class:'attendance-confirm-actions'}),error=el('p','',{class:'attendance-dialog-error',role:'alert'});
    let pending=false;
    const close=()=>{if(pending)return;dialog.close();dialog.remove();content.querySelector('[aria-label="Canvas course ID"]')?.focus();};
    const confirm=button('Change course',async()=>{
      if(pending)return;
      pending=true;error.textContent='';confirm.disabled=true;cancel.disabled=true;
      const ok=await run(()=>backend.saveCanvasCourse(term,id,true),'Course changed. Copied Canvas data and mappings cleared.');
      pending=false;
      if(ok)close();else{error.textContent=status.textContent;confirm.disabled=false;cancel.disabled=false;}
    });
    const cancel=button('Cancel',close);
    confirm.className=cancel.className='materials-button';
    actions.append(confirm,cancel);
    dialog.append(el('h3','Change Canvas course?'),el('p',`${previous} → ${id}`),
      el('p','This clears the copied Canvas data for this term. Mappings are cleared too.'),error,actions);
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    document.body.append(dialog);dialog.showModal();cancel.focus();
  }
  async function run(task,message) {
    if(readOnly)return false;
    content.querySelectorAll('button,input,select').forEach(n=>n.disabled=true);status.textContent='Working…';
    try {await task();await draw();status.textContent=message;return true;}
    catch(e){status.textContent=e.message;content.querySelectorAll('button,input,select').forEach(n=>n.disabled=false);return false;}
    finally{document.dispatchEvent(new Event('course:content-changed'));}
  }
  try{await draw();}catch(e){status.textContent=e.message;}
}
export function renderCanvasMode({root,backend,term,renderLegacy}) {
  const label=el('label','View ',{class:'canvas-mode'}),select=el('select',null,{'aria-label':'Gradebook mode'});
  select.append(el('option','Grade entry',{value:'legacy'}),el('option','Canvas status',{value:'canvas'}));label.append(select);
  const legacy=el('div',null,{'data-legacy-gradebook':''}),canvas=el('div',null,{'data-canvas-gradebook':''});canvas.hidden=true;
  root.append(label,legacy,canvas);renderLegacy(legacy);
  select.addEventListener('change',async()=>{
    legacy.hidden=select.value!=='legacy';canvas.hidden=!legacy.hidden;
    if(canvas.hidden)return;
    canvas.replaceChildren(el('p','Loading Canvas…',{role:'status'}));
    try {
      const data=await backend.canvasData(term);if(!canvas.isConnected)return;
      canvas.replaceChildren(el('p',health(data),{'data-canvas-health':''}),el('p','Read-only Canvas status. Grade entry remains available during the transition.'));
      if(!data.course?.generation){canvas.append(el('p','No Canvas snapshot. Configure and sync Canvas in Settings.'));return;}
      const table=el('table',null,{class:'class-grid canvas-grid'}),head=el('tr');head.append(el('th','Student',{scope:'col'}));
      for(const m of data.mappings)head.append(el('th',m.site_key,{scope:'col',title:data.assignments.find(a=>String(a.id)===String(m.canvas_assignment_id))?.name||m.site_key}));
      const thead=el('thead'),tbody=el('tbody');thead.append(head);table.append(thead,tbody);
      const wrap=el('div',null,{class:'class-grid-wrap',tabindex:'0','aria-label':'Scrollable Canvas status table'});wrap.append(table);canvas.append(wrap);
      const panel=el('section',null,{class:'canvas-popup',role:'dialog','aria-modal':'false','aria-label':'Canvas submission details'});panel.hidden=true;canvas.append(panel);
      let previous;
      const close=()=>{panel.hidden=true;previous?.focus();};panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
      for(const u of data.enrollments) {
        const tr=el('tr'),name=el('th',u.name,{scope:'row'});name.append(el('small',u.uni||u.login_id||'Unmatched'));tr.append(name);
        for(const m of data.mappings) {
          const s=data.submissions.find(s=>String(s.user_id)===String(u.user_id)&&String(s.assignment_id)===String(m.canvas_assignment_id)),td=el('td');
          const cell=button((canvasAvailable(data)?canvasStatus(s,m):'Status unavailable'),()=>{
            previous=cell;panel.replaceChildren();panel.hidden=false;
            const closeButton=button('Close details',close),a=data.assignments.find(a=>String(a.id)===String(m.canvas_assignment_id));
            panel.append(closeButton,el('h3',`${u.name} · ${a?.name||m.site_key}`));
            for(const [key,value] of [['Status',(canvasAvailable(data)?canvasStatus(s,m):'Status unavailable')],['Submitted',time(s?.submitted_at)],['Due',time(s?.cached_due_at)],['Seconds late',s?.seconds_late??'—'],['Score',s?.score??'—'],['Posted',canvasPosted(s)?time(s.posted_at):'Not posted'],['Roster match',u.match_status]])panel.append(el('p',`${key}: ${value}`));
            if(m.kind==='quiz')panel.append(el('p',`Attendance eligibility: ${canvasPresent(s)?'Present':'No qualifying score'}`));
            panel.append(el('a','Open in CourseWorks →',{href:`${CANVAS_HOST}/courses/${data.course.course_id}/assignments/${m.canvas_assignment_id}/submissions/${u.user_id}`,target:'_blank',rel:'noopener noreferrer'}));
            closeButton.focus();
          });cell.setAttribute('aria-label',`${u.name} ${m.site_key}: ${(canvasAvailable(data)?canvasStatus(s,m):'Status unavailable')}`);td.append(cell);tr.append(td);
        }
        tbody.append(tr);
      }
      if(!data.mappings.length)canvas.append(el('p','No assignment mappings. Add mappings in Settings.'));
      document.dispatchEvent(new Event('course:content-changed'));
    } catch(e){canvas.replaceChildren(el('p',e.message,{role:'status'}));}
  });
}
