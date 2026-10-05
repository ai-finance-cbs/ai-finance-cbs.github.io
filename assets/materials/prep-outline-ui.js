import { noteValues, prepMarkdown } from './prep-core.js';
import { OTHER_NOTES, preparationSections, parsePreparation, serializePreparation } from './prep-outline-core.js';
import { trackPreparationEditor } from './prep-ui.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  return node;
};
function grow(input) {
  if (!input.getClientRects().length) return;
  input.style.height = '0px'; input.style.height = `${input.scrollHeight + 1}px`;
}
window.addEventListener('resize', () => document.querySelectorAll('[data-prep-section-input]').forEach(grow));

export function renderPreparationOutline({ root, note, outline, backend }) {
  const sections = preparationSections(outline), names = sections.map(section => section.name);
  let saved = parsePreparation(note.body,names), saving = false;
  const controls = [];
  root.append(el('p',outline.goal,{class:'preparation-goal'}));
  let exercises, lecture;
  for (const [index,section] of sections.entries()) {
    if (section.name === OTHER_NOTES && !saved[section.name]) continue;
    // Lecture topics share one reddish block; exercises share another.
    if (section.lecture && !lecture) { lecture = el('div',null,{class:'preparation-lecture'}); root.append(lecture); }
    if (section.exercise && !exercises) {
      exercises = el('section',null,{class:'preparation-exercises'});
      exercises.append(el('h2','In-class exercises')); root.append(exercises);
    }
    const panel = el('section',null,{class:'preparation-section','data-prep-section':section.name,id:`prep-section-${index+1}`});
    const heading = el('div',null,{class:'prep-section-heading'});
    heading.append(el(section.exercise ? 'h3' : 'h2',section.name));
    const edit = el('button','',{type:'button',class:'prep-text-action'});
    heading.append(edit); panel.append(heading);
    if (section.reference) panel.append(el('p',section.reference,{class:'prep-reference'}));
    const output = el('div',null,{class:'prep-markdown','data-prep-markdown':''});
    const form = el('form',null,{class:'prep-section-form'});
    const label = section.name === OTHER_NOTES ? section.name : `${section.name} notes`;
    const input = el('textarea',null,{'aria-label':label,rows:'2',maxlength:'50000','data-prep-section-input':''});
    input.value = saved[section.name];
    const actions = el('div',null,{class:'prep-controls'});
    const save = el('button','Save',{type:'submit',class:'prep-text-action'}), cancel = el('button','Cancel',{type:'button',class:'prep-text-action'});
    const status = el('span','',{role:'status','data-prep-status':''});
    actions.append(save,cancel); form.append(input,actions); panel.append(output,form,status);
    (section.exercise ? exercises : section.lecture ? lecture : root).append(panel);
    let editing = false, updated = saved[section.name] ? note.updated_at : null;
    const dirty = () => input.value !== saved[section.name];
    const enable = () => { save.disabled = saving || !dirty(); cancel.disabled = saving; };
    controls.push(enable);
    const render = () => {
      edit.textContent = saved[section.name] ? 'Edit' : 'Add notes';
      edit.setAttribute('aria-label',`${saved[section.name] ? 'Edit' : 'Add'} ${label}`);
      edit.classList.toggle('empty',!saved[section.name]);
      edit.hidden = editing; form.hidden = !editing; output.hidden = editing;
      output.innerHTML = prepMarkdown(saved[section.name],{newTab:true});
      status.textContent = dirty() ? 'Unsaved changes' : updated ? `Saved ${new Date(updated).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}` : '';
      enable(); if (editing) grow(input);
    };
    edit.addEventListener('click',() => { editing = true; render(); input.focus(); });
    cancel.addEventListener('click',() => { input.value = saved[section.name]; editing = false; render(); edit.focus(); });
    input.addEventListener('input',() => { status.textContent = dirty() ? 'Unsaved changes' : ''; enable(); grow(input); });
    form.addEventListener('submit',async event => {
      event.preventDefault(); if (saving || !dirty()) return;
      saving = true; controls.forEach(update => update()); input.disabled = true; status.textContent = 'Saving…';
      // Save this section only. Other open drafts remain unsaved and keep their warning.
      const next = { ...saved, [section.name]:input.value };
      try {
        const body = serializePreparation(next,names); noteValues(note.week,body);
        const row = await backend.saveInstructorNote(note.week,body);
        saved = next; updated = row.updated_at; editing = false; render(); edit.focus();
      } catch (error) { status.textContent = error.message; }
      finally { saving = false; input.disabled = false; controls.forEach(update => update()); }
    });
    trackPreparationEditor(panel,dirty); render();
  }
}
