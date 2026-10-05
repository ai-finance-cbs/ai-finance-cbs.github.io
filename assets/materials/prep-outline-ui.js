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
  let plan, appendix;
  for (const [index,section] of sections.entries()) {
    // Other notes stay stored with the week but are not shown.
    if (section.name === OTHER_NOTES) continue;
    // Each plan item is its own card: lecture parts light red, exercises light blue.
    if (section.kind && !section.appendix && !plan) { plan = el('div',null,{class:'preparation-plan'}); root.append(plan); }
    if (section.appendix && !appendix) {
      appendix = el('section',null,{class:'preparation-appendix'});
      appendix.append(el('h2','Appendix')); root.append(appendix);
    }
    const panel = el('section',null,{class:`preparation-section${section.kind ? ` prep-${section.kind === 'quiz' ? 'lecture' : section.kind}` : ''}`,'data-prep-section':section.name,id:`prep-section-${index+1}`});
    const heading = el('div',null,{class:'prep-section-heading'});
    const prefix = { exercise:'In-Class Exercise: ', lecture:'Lecture: ' }[section.kind] || '';
    heading.append(el(section.appendix ? 'h3' : 'h2',prefix + section.name));
    const edit = el('button','',{type:'button',class:'prep-text-action'});
    heading.append(edit); panel.append(heading);
    const output = el('div',null,{class:'prep-markdown','data-prep-markdown':''});
    const form = el('form',null,{class:'prep-section-form'});
    const label = section.name === OTHER_NOTES ? section.name : `${section.name} notes`;
    const input = el('textarea',null,{'aria-label':label,rows:'2',maxlength:'50000','data-prep-section-input':''});
    input.value = saved[section.name];
    const actions = el('div',null,{class:'prep-controls'});
    const save = el('button','Save',{type:'submit',class:'prep-text-action'}), cancel = el('button','Cancel',{type:'button',class:'prep-text-action'});
    const status = el('span','',{role:'status','data-prep-status':''});
    actions.append(save,cancel); form.append(input,actions); panel.append(output,form,status);
    (section.appendix ? appendix : section.kind ? plan : root).append(panel);
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
