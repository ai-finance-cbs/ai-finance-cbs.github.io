import {SURVEY_OPENING,QUESTIONS,PROGRAMS,SECTORS,FREQUENCIES,AI_TOOLS,EXPERIENCE,SETUP_TOOLS,ASSISTANTS,VIEWS,TEXT_LIMITS,emptySurvey,validateSurvey,surveyClosed,surveySummary,surveyCSV} from './survey-core.js';
import {trackPreparationEditor} from './prep-ui.js';
const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const date=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'';
const button=(text,fn,className='materials-button')=>{const n=el('button',text,className);n.type='button';n.addEventListener('click',fn);return n;};
let formId=0;
function editor(root,ctx,result) {
  const row=result.submission,value=structuredClone(row?{answers:row.answers,q9:row.q9,q10:row.q10}:emptySurvey(result.roster_name || ''));
  const a=value.answers,uni=result.uni || ctx.access.uni || ctx.access.email?.match(/^([a-z]{1,8}[0-9]{1,8})@columbia\.edu$/i)?.[1]?.toLowerCase() || '';
  const permanentLock=!!(result.read_only || ctx.access.view_as || ctx.access.read_only),prefix=`survey-${++formId}`;
  let stored=row,saved=JSON.stringify(value),busy=false,submitting=false,timer=null,savedTimer=null,justSaved=false;
  let everSubmitted=row?.status==='submitted';
  const closed=()=>!!result.due_at && surveyClosed(result.due_at),locked=()=>permanentLock || closed();
  const form=el('form','','survey-editor');form.noValidate=true;form.setAttribute('aria-label','Pre-Class Survey');
  const status=el('div','','survey-status task-map-status'),pill=el('span','','survey-state'),savedTime=el('span'),banner=el('p','','survey-warning');
  savedTime.setAttribute('role','status');
  banner.setAttribute('role','status');status.append(pill,savedTime);form.append(status,banner,el('p',SURVEY_OPENING,'survey-opening'));
  const controls=[];
  function section(title) {const n=el('section','','survey-section');n.append(el('h3',title));form.append(n);return n;}
  function question(parent,id,hint='',optional=false) {
    const n=el('fieldset','','survey-question'),legend=el('legend',QUESTIONS[id]);legend.id=`${prefix}-${id}`;
    if (optional) legend.append(el('span',' (optional)','survey-optional'));
    n.append(legend);if(hint)n.append(el('p',hint,'survey-hint'));parent.append(n);return n;
  }
  function text(parent,key,paragraph=false,subfield='') {
    const wrap=el(subfield?'label':'div',subfield,'survey-field'),input=el(paragraph?'textarea':'input');
    if(subfield)input.setAttribute('aria-label',subfield);
    else input.setAttribute('aria-labelledby',parent.querySelector('legend').id);
    input.maxLength=TEXT_LIMITS[key];input.value=a[key];
    if(paragraph)input.rows=3;else input.type='text';
    input.addEventListener('input',()=>{a[key]=input.value;changed();});controls.push(input);wrap.append(input);parent.append(wrap);return input;
  }
  function choices(parent,key,values) {
    const list=el('div','','survey-choices');
    for(const choice of values){const label=el('label'),input=el('input');input.type='radio';input.name=`${prefix}-${key}`;input.value=choice;input.checked=a[key]===choice;
      input.addEventListener('change',()=>{a[key]=choice;changed();});controls.push(input);label.append(input,el('span',choice));list.append(label);}
    parent.append(list);
  }
  function grid(parent,key,tools,values) {
    const table=el('table','','survey-grid'),head=el('thead'),hr=el('tr'),body=el('tbody');hr.append(el('th','Tool'));
    for(const choice of values){const th=el('th',choice);th.scope='col';hr.append(th);}head.append(hr);
    for(const [id,name] of tools){const tr=el('tr'),th=el('th',name);th.scope='row';tr.append(th);
      for(const choice of values){const td=el('td'),label=el('label'),input=el('input');input.type='radio';input.name=`${prefix}-${key}-${id}`;input.value=choice;input.checked=a[key][id]===choice;
        input.setAttribute('aria-label',`${name}: ${choice}`);input.addEventListener('change',()=>{a[key][id]=choice;changed();});controls.push(input);
        label.append(input,el('span',choice));td.append(label);tr.append(td);}body.append(tr);}
    table.append(head,body);parent.append(table);
  }
  const about=section('Section 1. About you'),q1=question(about,'q1'),identity=el('div','','survey-identity');q1.append(identity);
  text(identity,'full_name',false,'Full name');const uniLabel=el('label','UNI','survey-field'),uniInput=el('input');uniInput.value=uni;uniInput.readOnly=true;uniInput.setAttribute('aria-label','UNI');uniLabel.append(uniInput);identity.append(uniLabel);
  text(question(about,'q2'),'preferred_name');choices(question(about,'q3'),'program',PROGRAMS);
  text(question(about,'q4','Say what kind of firm it was, what your role was, and what you spent most of your time on. Do not name clients or confidential deals.'),'job',true);
  const q5=question(about,'q5'),sectorLabel=el('div','','survey-field'),sector=el('select');sector.setAttribute('aria-labelledby',q5.querySelector('legend').id);
  for(const name of ['',...SECTORS]){const option=el('option',name || 'Choose…');option.value=name;sector.append(option);}sector.value=a.sector;
  sector.addEventListener('change',()=>{a.sector=sector.value;changed();});controls.push(sector);sectorLabel.append(sector);q5.append(sectorLabel);text(q5,'career_examples',false,'One or two example firms or roles');
  const ai=section('Section 2. You and AI'),q6=question(ai,'q6');grid(q6,'ai_frequency',AI_TOOLS,FREQUENCIES);text(q6,'other_tool',false,'Other (name it)');
  text(question(ai,'q7','1 to 3 sentences'),'ai_use',true);text(question(ai,'q8'),'wish');
  const views=section('Section 3. Your views (we revisit these in Week 6)'),q9=question(views,'q9'),checks=el('div','','survey-choices');
  for(const [id,labelText] of VIEWS){const label=el('label'),input=el('input');input.type='checkbox';input.value=id;input.checked=value.q9.includes(id);
    input.addEventListener('change',()=>{value.q9=VIEWS.map(([k])=>k).filter(k=>k===id?input.checked:value.q9.includes(k));changed();});controls.push(input);label.append(input,el('span',labelText));checks.append(label);}q9.append(checks);
  const q10=question(views,'q10','0 to 100%'),predictionLabel=el('div','','survey-field'),prediction=el('input');prediction.type='number';prediction.min='0';prediction.max='100';prediction.step='any';prediction.value=value.q10??'';
  prediction.setAttribute('aria-labelledby',q10.querySelector('legend').id);prediction.addEventListener('input',()=>{value.q10=prediction.value===''?null:prediction.valueAsNumber;changed();});controls.push(prediction);predictionLabel.append(prediction);q10.append(predictionLabel);
  text(question(views,'q11','',true),'worries');
  const logistics=section('Section 4. Logistics');grid(question(logistics,'q12'),'experience',SETUP_TOOLS,EXPERIENCE);
  text(question(logistics,'q13','accessibility needs, a planned absence, a topic you want covered, a speaker you would love to hear from',true),'other_info',true);
  const setup=section('Setup check (M1 = survey + VS Code setup)'),guide=el('a','Setup Guide');guide.href='/syllabus/setup/';setup.append(guide);
  choices(question(setup,'s1'),'setup_assistant',ASSISTANTS);text(question(setup,'s2'),'setup_version');
  text(question(setup,'s3'),'setup_haiku',true);
  const message=el('p','','survey-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const draftWarning=el('p','','survey-hint'),actions=el('div','','survey-actions');
  const submit=button('Submit',()=>persist(true),'materials-button survey-primary');
  actions.append(submit);form.append(message,draftWarning,actions);
  if(!permanentLock)form.append(el('p','Your answers save automatically as you type. Use Submit when you are finished.','survey-hint'));
  form.addEventListener('submit',e=>{e.preventDefault();persist(true);});
  function update() {
    pill.textContent=stored?.status==='submitted'?`Submitted ${date(stored.submitted_at)}`:'Draft';
    savedTime.textContent=busy || timer!==null?'Saving…':justSaved && !dirty()?'Saved!':dirty()?'Unsaved changes':stored?.updated_at?`Saved ${date(stored.updated_at)}`:'';
    banner.textContent=permanentLock?'Read-only view':closed()?`Submissions closed ${date(result.due_at)}`:!result.due_at?'Canvas M1 deadline unavailable. You can fill in the form, but saving is unavailable until the teaching team restores the deadline.':'';
    banner.hidden=!banner.textContent;
    for(const input of controls) input.disabled=locked() || submitting;
    actions.hidden=locked();submit.disabled=busy || surveyClosed(result.due_at);
    draftWarning.textContent=!locked() && everSubmitted && stored?.status!=='submitted'?'Your changes are saved, but your submission is no longer complete. Submit again before the deadline.':'';
  }
  function dirty(){return JSON.stringify(value)!==saved;}
  function changed(){justSaved=false;message.textContent='';scheduleSave();update();}
  function scheduleSave(){clearTimeout(timer);timer=null;if(form.isConnected && !locked() && !surveyClosed(result.due_at) && dirty())timer=setTimeout(()=>persist(false),1000);}
  // Autosave a snapshot so edits made during a slow request are saved next, never overwritten.
  async function persist(explicitSubmit) {
    clearTimeout(timer);timer=null;
    if(busy){if(!explicitSubmit)scheduleSave();return;}
    if(!form.isConnected || locked() || surveyClosed(result.due_at)){update();return;}
    if(!explicitSubmit && !dirty())return;
    const snapshot=structuredClone(value);let asSubmit=explicitSubmit;
    if(!explicitSubmit && stored?.status==='submitted'){try{validateSurvey(snapshot,true);asSubmit=true;}catch{asSubmit=false;}}
    try {validateSurvey(snapshot,asSubmit);busy=true;submitting=explicitSubmit;justSaved=false;update();message.textContent=explicitSubmit?'Submitting…':'';
      stored=await ctx.backend.saveSurvey(ctx.data.term_id,snapshot,asSubmit);saved=JSON.stringify(snapshot);everSubmitted ||= asSubmit;justSaved=true;
      clearTimeout(savedTimer);savedTimer=setTimeout(()=>{justSaved=false;if(form.isConnected)update();},2500);
      message.textContent=explicitSubmit?'Survey submitted.':'';
    } catch(error){message.textContent=error.message;} finally{busy=false;submitting=false;if(JSON.stringify(value)!==JSON.stringify(snapshot))scheduleSave();update();}
  }
  root.append(form);const panelHead=root.querySelector(':scope > .assignment-panel-head');if(panelHead){status.classList.add('in-panel-head');panelHead.append(status);}
  update();if(!permanentLock)trackPreparationEditor(form,()=>busy || dirty());
  function schedule(){if(!form.isConnected || permanentLock || surveyClosed(result.due_at))return;
    setTimeout(()=>{if(form.isConnected){update();schedule();}},Math.min(2147483647,Math.max(1,Date.parse(result.due_at)-Date.now())));}
  schedule();
}
function staffView(root,ctx,result) {
  const all=[...result.students,...result.unrostered],summary=surveySummary(all),roster=surveySummary(result.students),staff=el('div','','survey-staff');
  staff.append(el('p',`${roster.submitted} submitted / ${roster.roster} roster · ${roster.drafts} drafts · ${roster.roster-roster.submitted-roster.drafts} not started`,'survey-counts'),el('p','Summaries use submitted responses only.','survey-hint'));
  const exportStatus=el('p','','survey-message');exportStatus.setAttribute('role','status');
  const download=button('Export CSV',async()=>{
    download.disabled=true;
    try {const fresh=await ctx.backend.surveyClass(ctx.data.term_id),csv=surveyCSV([...fresh.students,...fresh.unrostered]);
      const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'})),link=el('a');link.href=url;link.download=`m1-survey-${ctx.data.term_id}.csv`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);exportStatus.textContent='CSV exported.';
    }catch(error){exportStatus.textContent=error.message;}finally{download.disabled=false;}
  },'materials-button survey-secondary');staff.append(download,exportStatus);
  function counts(title,entries){const section=el('section','','survey-summary');section.append(el('h3',title));const list=el('dl');
    for(const [name,count] of entries)list.append(el('dt',name),el('dd',String(count)));section.append(list);staff.append(section);}
  counts(QUESTIONS.q9,VIEWS.map(([id,name])=>[name,summary.q9[id]]));
  const prediction=el('section','','survey-summary');prediction.append(el('h3',QUESTIONS.q10),el('p',summary.q10?`Min ${summary.q10.min}% · Median ${summary.q10.median}% · Max ${summary.q10.max}%`:'No submitted predictions yet.','survey-distribution'));staff.append(prediction);
  counts(QUESTIONS.q5,Object.entries(summary.sectors));counts(QUESTIONS.s1,Object.entries(summary.setup));
  function students(title,rows){staff.append(el('h3',title));
    for(const student of rows){const details=el('details','','survey-response'),head=el('summary'),name=el('span',student.name),state=el('span',student.submission?.status==='submitted'?`Submitted ${date(student.submission.submitted_at)}`:student.submission?'Draft':'Not started');
      name.append(el('small',student.uni));head.append(name,state);details.append(head);
      details.addEventListener('toggle',()=>{if(details.open && details.childElementCount===1){
        if(student.submission)editor(details,ctx,{uni:student.uni,roster_name:student.name,submission:student.submission,read_only:true,due_at:null});
        else details.append(el('p','No survey saved.'));}});staff.append(details);}
  }
  students('Students',result.students);if(result.unrostered.length)students('Saved responses outside the current roster',result.unrostered);root.append(staff);
}
export async function renderSurvey(root,ctx) {
  if(!['student','instructor','grader'].includes(ctx.access.role))return;
  const loading=el('p','Loading survey…','survey-hint');root.append(loading);
  try {const staff=['instructor','grader'].includes(ctx.access.role),result=await(staff?ctx.backend.surveyClass(ctx.data.term_id):ctx.backend.mySurvey(ctx.data.term_id));
    if(!root.isConnected)return;loading.remove();if(staff)staffView(root,ctx,result);else editor(root,ctx,result);
  }catch(error){loading.textContent=`Survey unavailable: ${error.message}`;loading.setAttribute('role','alert');}
}
