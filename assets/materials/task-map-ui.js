import {TASK_LABELS, emptyTask, emptyTaskMap, completeTask, wordCount, taskTally, taskMapClosed, validateTaskMap, taskMapSummary} from './task-map-core.js';
import {trackPreparationEditor} from './prep-ui.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
const date = value => value ? new Date(value).toLocaleString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) + ' ET' : '';
const JOB_QUESTIONS = [['firm_type','What kind of firm did you work at?'],['role','What was your role?'],['duration','How long were you there?']];
const AHEAD_TASK = 'Which task is not part of this job today but will become part of it as AI spreads?';
const AHEAD_DESCRIPTION = 'Describe that task in one sentence.';
const REASON_QUESTION = 'Why do you think so? (three to five sentences)';
const chip = (label, suffix = '') => el('span', label + suffix, `task-label is-${label.toLowerCase()}`);
const action = (text, handler, style = 'text-action') => {
  const b = el('button', text, style); b.type = 'button'; b.addEventListener('click', handler); return b;
};
function grow(input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }

// A separate text document avoids clipped input values and textarea pagination in print.
function printMap(value, title) {
  document.querySelector('.task-map-print-target')?.remove();
  const paper = el('article', '', 'task-map-print-target'); paper.append(el('h1', title));
  paper.append(el('h2', 'The job'));
  for (const [key, label] of JOB_QUESTIONS) paper.append(el('h3', label), el('p', value.job[key]));
  const table = el('table'), head = el('thead'), hr = el('tr'), body = el('tbody');
  for (const label of ['#','Task','Description','Label']) hr.append(el('th',label));
  head.append(hr);
  value.tasks.forEach((t,i) => {
    if (!t.name && !t.description && !t.label) return;
    const row = el('tr'), label = el('td'); if (t.label) label.append(chip(t.label));
    row.append(el('td',String(i+1)),el('td',t.name),el('td',t.description),label); body.append(row);
  });
  table.append(head,body); paper.append(el('h2','Tasks'),table,el('h2','Look ahead'),el('h3',value.look_ahead.name),el('p',value.look_ahead.description));
  paper.append(el('h3',REASON_QUESTION),el('p',value.look_ahead.reasoning));
  document.body.append(paper);
  window.addEventListener('afterprint', () => paper.remove(), {once:true});
  window.print();
}

function studentForm(root, ctx, result, title = 'Milestone #2: Task map') {
  const row = result.submission;
  const value = structuredClone(row ? {job:row.job,tasks:row.tasks,look_ahead:row.look_ahead,ai_use:row.ai_use} : emptyTaskMap());
  if (!value.tasks.length) value.tasks.push(emptyTask());
  let saved = JSON.stringify(value), stored = row, busy = false;
  const permanentLock = result.read_only || !!ctx.access.view_as || !!ctx.access.read_only;
  const readOnly = () => permanentLock || taskMapClosed(result.due_at);
  const form = el('form', '', 'task-map-editor'); form.noValidate = true;
  form.setAttribute('aria-label', title);
  const status = el('div','','task-map-status'), pill = el('span','','task-map-state'), savedTime = el('span');
  status.append(pill,savedTime); form.append(status);
  const banner = el('p','','task-map-warning'); banner.setAttribute('role','status'); form.append(banner);
  const controls = [], writableActions = [];
  function input(label, target, key, max, textarea = false) {
    const field = el(textarea ? 'textarea' : 'input'); field.setAttribute('aria-label',label); field.maxLength = max;
    if (textarea) field.rows = 1; else field.type = 'text';
    field.value = target[key]; controls.push(field);
    field.addEventListener('input', () => { target[key] = field.value; if (textarea) grow(field); update(); });
    return field;
  }
  function select(label, target) {
    const field = el('select','','task-label'); field.setAttribute('aria-label',label);
    for (const name of ['',...TASK_LABELS]) { const option = el('option',name || 'Choose…'); option.value = name; field.append(option); }
    field.value = target.label || ''; controls.push(field);
    const color = () => { field.className = `task-label${field.value ? ' is-'+field.value.toLowerCase() : ''}`; };
    field.addEventListener('change', () => { target.label = field.value || null; color(); update(); }); color(); return field;
  }
  function field(label, control) { const wrap = el('label',label,'task-map-field'); wrap.append(control); return wrap; }
  function panel(heading, hint = '') {
    const box = el('section','','task-map-panel'); box.append(el('h3',heading));
    if (hint) box.append(el('p',hint,'task-map-hint')); form.append(box); return box;
  }
  const job = panel('1 · The job');
  const jobFields = el('div','','task-map-job');
  for (const [key,label] of JOB_QUESTIONS) jobFields.append(field(label,input(label,value.job,key,120,true)));
  job.append(jobFields);
  const tasks = panel('2 · Tasks');
  const table = el('table','','task-map-tasks'), head = el('thead'), hr = el('tr'), body = el('tbody');
  for (const label of ['#','Task','Description','Label','']) hr.append(el('th',label)); head.append(hr); table.append(head,body);
  const add = action('+ Add task', () => { if (readOnly() || busy || value.tasks.length >= 12) return; value.tasks.push(emptyTask()); rows(); update(); });
  writableActions.push(add);
  const tally = el('div','','task-map-tally'), nudge = el('span','','task-map-nudge');
  tasks.append(table,add,tally);
  function rows() {
    body.replaceChildren();
    value.tasks.forEach((task,i) => {
      const tr = el('tr'), name = el('td'), description = el('td'), label = el('td'), remove = el('td');
      const taskName = input(`Task ${i+1}`,task,'name',80,true), taskDescription = input(`Description ${i+1}`,task,'description',400,true);
      taskName.placeholder = 'Task'; taskDescription.placeholder = 'Description';
      name.append(taskName); description.append(taskDescription);
      label.append(select(`Label ${i+1}`,task));
      const del = action('×', () => { if (readOnly() || busy || value.tasks.length <= 1) return; value.tasks.splice(i,1); rows(); update(); });
      del.setAttribute('aria-label',`Remove task ${i+1}`); del.disabled = value.tasks.length <= 1;
      del.dataset.removeTask = ''; writableActions.push(del); remove.append(del);
      tr.append(el('td',String(i+1),'task-map-number'),name,description,label,remove); body.append(tr);
    });
    requestAnimationFrame(() => { if (form.isConnected) body.querySelectorAll('textarea').forEach(grow); });
  }
  rows();
  const ahead = panel('3 · Look ahead');
  const aheadFields = el('div','','task-map-ahead');
  aheadFields.append(field(AHEAD_TASK,input(AHEAD_TASK,value.look_ahead,'name',80,true)),
    field(AHEAD_DESCRIPTION,input(AHEAD_DESCRIPTION,value.look_ahead,'description',400,true)));
  const reason = input(REASON_QUESTION,value.look_ahead,'reasoning',2000,true), words = el('p','','task-map-words');
  reason.rows = 6; reason.classList.add('task-map-reason');
  ahead.append(aheadFields,field(REASON_QUESTION,reason),words);
  const message = el('p','','task-map-message'); message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  const draftWarning = el('p','','task-map-hint');
  const actions = el('div','','task-map-actions');
  const submit = action('Submit',() => persist(true),'materials-button task-map-primary');
  const print = action('Export to PDF',() => printMap(value,title)); print.classList.add('task-map-export');
  writableActions.push(submit); actions.append(submit,print);
  form.append(message,draftWarning,actions);
  if (!permanentLock) form.append(el('p',`Your answers save automatically as you type. You can edit and resubmit until ${date(result.due_at) || 'the deadline is set'}. Your answers are visible only to you and the teaching team.`,'task-map-hint'));
  form.addEventListener('submit',event => { event.preventDefault(); persist(true); });
  function update() {
    const locked = readOnly(), dirty = JSON.stringify(value) !== saved;
    pill.textContent = stored?.status === 'submitted' ? `Submitted ${date(stored.submitted_at)}` : 'Draft';
    if (!busy) savedTime.textContent = dirty ? 'Saving…' : justSaved ? 'Saved!' : stored?.updated_at ? `Saved ${date(stored.updated_at)}` : '';
    if (dirty && !locked && !permanentLock) scheduleSave();
    banner.textContent = permanentLock ? 'Read-only view' : taskMapClosed(result.due_at) ? result.due_at ? `Submissions closed ${date(result.due_at)}` : 'Submission deadline unavailable.' : '';
    banner.hidden = !banner.textContent;
    for (const c of controls) c.disabled = locked || busy;
    for (const b of writableActions) { b.hidden = locked; b.disabled = locked || busy || (b === add && value.tasks.length >= 12) || (b.hasAttribute('data-remove-task') && value.tasks.length <= 1); }
    words.textContent = `${wordCount(value.look_ahead.reasoning)} words`;
    const counts = taskTally(value.tasks), total = Object.values(counts).reduce((a,b) => a+b,0);
    tally.replaceChildren(el('span',`${total} of 8–12 tasks labelled`),...TASK_LABELS.map(l => chip(l,` ${counts[l]}`)));
    nudge.textContent = 'No Own tasks yet. Who signed off?'; if (!counts.Own && total >= 1) tally.append(nudge);
    draftWarning.textContent = !locked && everSubmitted && stored?.status !== 'submitted' ? 'Your changes are saved, but your submission is no longer complete. Submit again before the deadline.' : '';
  }
  // Autosave: one second after the last edit. A submitted map stays submitted while it is still complete.
  let timer = null, justSaved = false;
  function scheduleSave() { clearTimeout(timer); timer = setTimeout(autosave, 1000); }
  async function autosave() {
    if (busy) { scheduleSave(); return; }
    if (readOnly() || JSON.stringify(value) === saved) return;
    let keepSubmitted = false;
    if (stored?.status === 'submitted') { try { validateTaskMap(value,true); keepSubmitted = true; } catch { keepSubmitted = false; } }
    const snapshot = structuredClone(value);
    try {
      validateTaskMap(snapshot,false); busy = true; savedTime.textContent = 'Saving…';
      stored = await ctx.backend.saveTaskMap(ctx.data.term_id,snapshot,keepSubmitted);
      saved = JSON.stringify(snapshot); justSaved = true;
      setTimeout(() => { justSaved = false; if (form.isConnected) update(); }, 2500);
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; update(); }
  }
  // Once a map has been submitted, warn if later edits leave it incomplete (saved only as a draft).
  let everSubmitted = stored?.status === 'submitted';
  async function persist(asSubmit) {
    clearTimeout(timer);
    if (busy || readOnly()) { update(); return; }
    try {
      validateTaskMap(value,asSubmit); busy = true; update(); message.textContent = asSubmit ? 'Submitting…' : 'Saving…';
      const snapshot = structuredClone(value);
      stored = await ctx.backend.saveTaskMap(ctx.data.term_id,snapshot,asSubmit);
      saved = JSON.stringify(snapshot); message.textContent = asSubmit ? 'Task map submitted.' : 'Draft saved.';
      if (asSubmit) everSubmitted = true;
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; update(); }
  }
  root.append(form);
  const panelHead = root.querySelector(':scope > .assignment-panel-head');
  if (panelHead) { status.classList.add('in-panel-head'); panelHead.append(status); }
  update();
  if (!permanentLock) trackPreparationEditor(form,() => busy || JSON.stringify(value) !== saved);
  requestAnimationFrame(() => { if (form.isConnected) form.querySelectorAll('textarea').forEach(grow); });
  // Reflow saved descriptions when a phone rotates or a staff row is expanded again.
  let width = 0;
  const resize = new ResizeObserver(entries => {
    if (!form.isConnected) { resize.disconnect(); return; }
    const next = entries[0].contentRect.width;
    if (next > 0 && next !== width) { width = next; form.querySelectorAll('textarea').forEach(grow); }
  });
  resize.observe(form);
  // Change to read-only while the page is open, without discarding unsaved work or print access.
  function deadlineTimer() {
    if (!form.isConnected || permanentLock || taskMapClosed(result.due_at)) return;
    setTimeout(() => { if (form.isConnected) { update(); deadlineTimer(); } },Math.min(2147483647,Math.max(1,Date.parse(result.due_at)-Date.now())));
  }
  deadlineTimer();
}

function staffView(root, ctx, result) {
  const all = [...result.students,...result.unrostered], summary = taskMapSummary(all);
  const counts = taskMapSummary(result.students).counts;
  const staff = el('div','','task-map-staff');
  staff.append(el('p',`${counts.submitted} submitted · ${counts.drafts} drafts · ${counts.not_started} not started`,'task-map-class-counts'));
  const distribution = el('div','','task-map-tally');
  for (const label of TASK_LABELS) distribution.append(chip(label,` ${summary.tally[label]} (${summary.total ? Math.round(100*summary.tally[label]/summary.total) : 0}%)`));
  staff.append(el('h3','Labels across submitted tasks'),distribution);
  function anonymous(title, tasks) {
    staff.append(el('h3',title)); const list = el('ul','','task-map-anonymous');
    for (const t of tasks) { const li = el('li'); if (t.label) li.append(chip(t.label)); li.append(el('strong',t.name),el('span',t.description)); list.append(li); }
    staff.append(list.childElementCount ? list : el('p','No submitted tasks yet.','task-map-hint'));
  }
  anonymous('Own tasks · anonymous',summary.own); anonymous('Look-ahead tasks · anonymous',summary.lookAhead);
  function roster(title, students) {
    staff.append(el('h3',title)); const table = el('table','','task-map-roster'), head = el('thead'), hr = el('tr'), body = el('tbody');
    for (const t of ['Student','Status','Submitted','Tasks']) hr.append(el('th',t)); head.append(hr);
    for (const student of students) {
      const row = student.submission, tr = el('tr'), name = el('td'), details = el('tr'), cell = el('td');
      details.hidden = true; cell.colSpan = 4; details.append(cell);
      const expand = action('',() => {
        details.hidden = !details.hidden; expand.setAttribute('aria-expanded',String(!details.hidden));
        if (!details.hidden && !cell.childElementCount) {
          if (row) studentForm(cell,ctx,{submission:row,read_only:true,due_at:null},`${student.name} (${student.uni}) · Task map`);
          else cell.append(el('p','No task map saved.'));
        }
      });
      expand.setAttribute('aria-expanded','false'); expand.append(el('span',student.name),el('small',student.uni)); name.append(expand);
      tr.append(name,el('td',row?.status === 'submitted' ? 'Submitted' : row ? 'Draft' : 'Not started'),el('td',date(row?.submitted_at) || '—'),el('td',String(row?.tasks.filter(completeTask).length || 0)));
      body.append(tr,details);
    }
    table.append(head,body); staff.append(table);
  }
  roster('Students',result.students);
  if (result.unrostered.length) roster('Saved work outside the current roster',result.unrostered);
  root.append(staff);
}
export async function renderTaskMap(root, ctx) {
  if (!['student','instructor','grader'].includes(ctx.access.role)) return;
  const loading = el('p','Loading task maps…','task-map-hint'); root.append(loading);
  try {
    const staff = ['instructor','grader'].includes(ctx.access.role);
    const result = await (staff ? ctx.backend.taskMapClass(ctx.data.term_id) : ctx.backend.myTaskMap(ctx.data.term_id));
    if (!root.isConnected) return;
    loading.remove();
    if (staff) staffView(root,ctx,result); else studentForm(root,ctx,result);
  } catch (error) { loading.textContent = `Task map unavailable: ${error.message}`; loading.setAttribute('role','alert'); }
}
