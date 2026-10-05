import { noteValues, prepMarkdown } from './prep-core.js';
import { OTHER_NOTES, CARD_KINDS, cardTitle, preparationDocument, serializePreparation, serializePreparationLayout, movePreparationCard } from './prep-outline-core.js';
import { trackPreparationEditor } from './prep-ui.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  return node;
};
const action = (text, click, attrs = {}) => {
  const node = el('button', text, { type:'button', class:'prep-text-action', ...attrs });
  node.addEventListener('click', click); return node;
};
function grow(input) {
  if (!input.getClientRects().length) return;
  input.style.height = '0px'; input.style.height = `${input.scrollHeight + 1}px`;
}
window.addEventListener('resize', () => document.querySelectorAll('[data-prep-section-input]').forEach(grow));

export function renderPreparationOutline({ root, note, outline, backend, confirmInline }) {
  let model = preparationDocument(note.body, outline), saving = false, confirming = false, detail = null, dragged = null;
  let contentEditors = [], layoutUpdates = [];
  const status = el('p','',{role:'status','data-prep-layout-status':''});
  const workspace = el('div',null,{class:'prep-workspace'});
  root.append(el('p',outline.goal,{class:'preparation-goal'}),status,workspace);
  const contentDirty = () => contentEditors.some(editor => editor.dirty());
  const blocked = () => saving || confirming || contentDirty();
  const detailsDirty = () => !!detail?.dirty();
  const sync = () => { contentEditors.forEach(editor => editor.enable()); layoutUpdates.forEach(update => update()); };
  const changed = () => document.dispatchEvent(new Event('course:content-changed'));
  trackPreparationEditor(workspace, () => saving || detailsDirty());

  async function saveLayout(next, focusName) {
    if (blocked()) return;
    saving = true; status.textContent = 'Saving…'; sync();
    try {
      const body = serializePreparationLayout(next); noteValues(note.week,body);
      const row = await backend.saveInstructorNote(note.week,body);
      model = { ...next, layout:true }; note.updated_at = row.updated_at;
      detail = null; draw(); status.textContent = 'Saved';
      saving = false; sync();
      const card = [...workspace.querySelectorAll('[data-prep-section]')].find(n => n.dataset.prepSection === focusName);
      (card?.querySelector('.prep-card-toggle') || workspace.querySelector('.prep-add-card'))?.focus({preventScroll:true});
    } catch (error) {
      // Do not change the displayed order until storage accepts the new layout.
      status.textContent = error.message;
    } finally { saving = false; sync(); }
  }
  function move(name, appendix, before) {
    if (blocked() || detailsDirty()) return;
    const sections = movePreparationCard(model.sections,name,appendix,before);
    if (sections.every((s,i) => s.name === model.sections[i].name && !!s.appendix === !!model.sections[i].appendix)) return;
    return saveLayout({...model,sections},name);
  }
  function clearDropTargets() { workspace.querySelectorAll('.prep-drop-target').forEach(n => n.classList.remove('prep-drop-target')); }
  function dropZone(node, appendix, section = null) {
    node.addEventListener('dragover',event => {
      if (!dragged || blocked() || detailsDirty()) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'move'; clearDropTargets();
      if (section?.name !== dragged) node.classList.add('prep-drop-target');
    });
    node.addEventListener('dragleave',event => { if (!node.contains(event.relatedTarget)) node.classList.remove('prep-drop-target'); });
    node.addEventListener('drop',event => {
      if (!dragged || blocked() || detailsDirty()) return;
      event.preventDefault(); event.stopPropagation(); clearDropTargets();
      const name = dragged; dragged = null;
      if (section?.name === name) return;
      let before = null;
      if (section) {
        const group = model.sections.filter(s => s.name !== 'Logistics' && s.name !== name && !!s.appendix === appendix);
        const rect = node.getBoundingClientRect();
        before = event.clientY < rect.top + rect.height / 2 ? section.name : group[group.findIndex(s => s.name === section.name)+1]?.name ?? null;
      }
      void move(name,appendix,before);
    });
  }
  function cardControls(panel, section, appendix, toggle) {
    if (blocked() || detailsDirty()) return;
    detail?.form.remove();
    const form = el('form',null,{class:'prep-card-form','aria-label':section ? `Card settings for ${section.name}` : `Add card to ${appendix ? 'Appendix' : 'plan'}`});
    const title = el('input',null,{type:'text',required:'',maxlength:'120','aria-label':'Card title'});
    const kind = el('select',null,{'aria-label':'Card type'});
    for (const value of CARD_KINDS) kind.append(el('option',{lecture:'Lecture',exercise:'In-Class Exercise',quiz:'Quiz'}[value],{value}));
    title.value = section?.name || ''; kind.value = section?.kind || 'lecture';
    const titleLabel = el('label','Title'), typeLabel = el('label','Type'); titleLabel.append(title); typeLabel.append(kind);
    const buttons = el('div',null,{class:'prep-card-actions'}), message = el('span','',{role:'status'});
    form.append(titleLabel,typeLabel,buttons,message);
    const dirty = () => title.value !== (section?.name || '') || kind.value !== (section?.kind || 'lecture');
    detail = { form, dirty };
    const controls = [];
    if (section) {
      const group = model.sections.filter(s => s.name !== 'Logistics' && !!s.appendix === appendix), index = group.indexOf(section);
      const up = action('Move up',() => void move(section.name,appendix,group[index-1]?.name));
      const down = action('Move down',() => void move(section.name,appendix,group[index+2]?.name ?? null));
      const across = action(appendix ? 'Move to plan' : 'Move to Appendix',() => void move(section.name,!appendix,null));
      const remove = action('Delete card',async () => {
        if (blocked() || dirty()) return;
        confirming = true; sync();
        const confirmed = await confirmInline(remove,`Delete ${section.name} and its notes?`);
        confirming = false; sync();
        if (!confirmed) return;
        const notes = { ...model.notes }; delete notes[section.name];
        await saveLayout({...model,sections:model.sections.filter(s => s !== section),notes});
      });
      buttons.append(up,down,across,remove); controls.push(up,down,across,remove);
      layoutUpdates.push(() => {
        for (const button of controls) button.disabled = blocked() || dirty();
        up.disabled ||= index === 0; down.disabled ||= index === group.length-1;
      });
    }
    const save = action('Save',() => {},{type:'submit'});
    const cancel = action('Cancel',() => { form.remove(); detail = null; sync(); toggle.focus(); });
    buttons.append(save,cancel);
    const update = () => {
      title.disabled = kind.disabled = blocked(); save.disabled = blocked() || !dirty(); cancel.disabled = saving || confirming;
      toggle.setAttribute('aria-expanded',String(form.isConnected));
    };
    layoutUpdates.push(update);
    const input = () => { message.textContent = ''; title.setCustomValidity(''); sync(); };
    title.addEventListener('input',input); kind.addEventListener('change',input);
    form.addEventListener('submit',async event => {
      event.preventDefault(); if (blocked()) return;
      try {
        const name = cardTitle(title.value,model.sections,section?.name);
        const next = { name, kind:kind.value, ...(appendix ? {appendix:true} : {}) };
        const sections = section ? model.sections.map(s => s === section ? next : s)
          : [...model.sections.filter(s => !s.appendix), ...(!appendix ? [next] : []), ...model.sections.filter(s => s.appendix), ...(appendix ? [next] : [])];
        const notes = { ...model.notes };
        if (section) delete notes[section.name];
        await saveLayout({...model,sections,notes:{...notes,[name]:section ? model.notes[section.name] : ''}},name);
      } catch (error) { message.textContent = error.message; }
    });
    if (section) panel.querySelector('.prep-section-heading').after(form); else panel.append(form);
    sync(); title.focus();
  }
  function draw() {
    workspace.replaceChildren(); contentEditors = []; layoutUpdates = [];
    const plan = el('div',null,{class:'preparation-plan','data-prep-group':'plan'});
    const appendix = el('section',null,{class:'preparation-appendix','data-prep-group':'appendix'});
    appendix.append(el('h2','Appendix'));
    dropZone(plan,false); dropZone(appendix,true);
    for (const [index,section] of model.sections.entries()) {
      const pinned = section.name === 'Logistics';
      const panel = el('section',null,{class:`preparation-section${pinned ? '' : ` prep-${section.kind === 'quiz' ? 'lecture' : section.kind}`}`,'data-prep-section':section.name,id:`prep-section-${index+1}`});
      const heading = el('div',null,{class:'prep-section-heading'});
      const prefix = {exercise:'In-Class Exercise: ',lecture:'Lecture: '}[section.kind] || '';
      heading.append(el(section.appendix ? 'h3' : 'h2',prefix + section.name));
      const edit = action('',() => { editing = true; render(); input.focus(); },{class:'prep-text-action prep-content-edit'});
      heading.append(edit); panel.append(heading);
      if (!pinned) {
        const card = action('⋯ Card',() => cardControls(panel,section,!!section.appendix,card),{class:'prep-text-action prep-card-toggle','aria-label':`Card settings for ${section.name}`,'aria-expanded':'false'});
        const grip = action('⠿',() => card.click(),{class:'prep-text-action prep-drag-grip',draggable:'true','aria-label':`Move ${section.name}`,title:'Drag to move; use Card settings for keyboard controls.'});
        heading.append(card,grip);
        layoutUpdates.push(() => {
          card.disabled = grip.disabled = blocked() || detailsDirty(); grip.draggable = !grip.disabled;
          card.setAttribute('aria-expanded',String(!!panel.querySelector('.prep-card-form')));
        });
        grip.addEventListener('dragstart',event => {
          if (blocked() || detailsDirty()) { event.preventDefault(); return; }
          dragged = section.name; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain',section.name);
        });
        grip.addEventListener('dragend',() => { dragged = null; clearDropTargets(); });
        dropZone(panel,!!section.appendix,section);
      }
      const output = el('div',null,{class:'prep-markdown','data-prep-markdown':''});
      const form = el('form',null,{class:'prep-section-form'}), label = `${section.name} notes`;
      const input = el('textarea',null,{'aria-label':label,rows:'2',maxlength:'50000','data-prep-section-input':''});
      input.value = model.notes[section.name];
      const actions = el('div',null,{class:'prep-controls'});
      const save = action('Save',() => {},{type:'submit'}), cancel = action('Cancel',() => {
        input.value = model.notes[section.name]; editing = false; render(); sync(); edit.focus();
      });
      const contentStatus = el('span','',{role:'status','data-prep-status':''});
      actions.append(save,cancel); form.append(input,actions); panel.append(output,form,contentStatus);
      (pinned ? workspace : section.appendix ? appendix : plan).append(panel);
      let editing = false, updated = model.notes[section.name] ? note.updated_at : null;
      const dirty = () => input.value !== model.notes[section.name];
      const enable = () => {
        const busy = saving || confirming || detailsDirty();
        save.disabled = busy || !dirty(); cancel.disabled = busy; input.disabled = edit.disabled = busy;
      };
      contentEditors.push({dirty,enable});
      const render = () => {
        edit.textContent = model.notes[section.name] ? 'Edit' : 'Add notes';
        edit.setAttribute('aria-label',`${model.notes[section.name] ? 'Edit' : 'Add'} ${label}`);
        edit.classList.toggle('empty',!model.notes[section.name]);
        edit.hidden = editing; form.hidden = !editing; output.hidden = editing;
        output.innerHTML = prepMarkdown(model.notes[section.name],{newTab:true});
        contentStatus.textContent = dirty() ? 'Unsaved changes' : updated ? `Saved ${new Date(updated).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}` : '';
        enable(); if (editing) grow(input);
      };
      input.addEventListener('input',() => { contentStatus.textContent = dirty() ? 'Unsaved changes' : ''; sync(); grow(input); });
      form.addEventListener('submit',async event => {
        event.preventDefault(); if (saving || !dirty() || detailsDirty()) return;
        saving = true; sync(); contentStatus.textContent = 'Saving…';
        const next = { ...model, notes:{...model.notes,[section.name]:input.value} };
        try {
          const body = model.layout ? serializePreparationLayout(next)
            : serializePreparation(next.notes,[...model.sections.map(s => s.name),OTHER_NOTES]);
          noteValues(note.week,body);
          const row = await backend.saveInstructorNote(note.week,body);
          model = next; updated = row.updated_at; editing = false; render(); changed();
          saving = false; sync(); edit.focus();
        } catch (error) { contentStatus.textContent = error.message; }
        finally { saving = false; sync(); }
      });
      trackPreparationEditor(panel,dirty); render();
    }
    for (const [container,isAppendix] of [[plan,false],[appendix,true]]) {
      const add = action('+ Add card',() => cardControls(container,null,isAppendix,add),{
        class:'prep-text-action prep-add-card','aria-label':`Add card to ${isAppendix ? 'Appendix' : 'plan'}`,'aria-expanded':'false'});
      container.append(add);
      layoutUpdates.push(() => { add.disabled = blocked() || detailsDirty(); add.setAttribute('aria-expanded',String(!!container.querySelector(':scope > .prep-card-form'))); });
    }
    workspace.append(plan,appendix); sync(); changed();
  }
  draw();
}
