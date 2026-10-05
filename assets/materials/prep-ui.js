import { prepMarkdown, sortedSpeakers, SPEAKER_LIMITS, safePrepLink } from './prep-core.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const button = (text, action) => {
  const node = el('button', text, { type:'button', class:'materials-button' });
  node.addEventListener('click', action); return node;
};
let editor = null;
const editors = new Set();
export function trackPreparationEditor(node, dirty) { editors.add({ node, dirty, pending:false }); }
const dirty = () => {
  for (const entry of editors) if (!entry.node.isConnected) editors.delete(entry);
  editor = [...editors].find(entry => entry.dirty());
  return !!editor;
};
export async function leavePreparation() {
  if (!dirty()) return true;
  if (editor.pending) return false;
  const current = editor;
  return new Promise(resolve => {
    const prompt = el('div', 'Unsaved changes. Leave without saving?', { class:'prep-warning', role:'alert' });
    const finish = value => { prompt.remove(); current.pending = false; if (value) editors.clear(); resolve(value); };
    const stay = button('Keep editing', () => finish(false));
    prompt.append(button('Leave without saving', () => finish(true)), stay);
    current.node.prepend(prompt); current.pending = true; stay.focus();
  });
}
// Native browser warning covers reload, Back, and closing a tab. Site links stay inline.
window.addEventListener('beforeunload', event => {
  if (dirty()) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('click', async event => {
  const link = event.target.closest('a[href]');
  if (!link || !dirty() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (await leavePreparation()) location.assign(link.href);
}, true);

// Both editors share saving, navigation warnings, and safe Markdown rendering.
export function renderPreparation({ root, note, backend, assignment = false, labelText = `Week ${note.week} notes`, editable = true }) {
  const panel = el('section', null, { class:'preparation-editor' });
  const form = el('form', null, { class:'admin-form prep-form' });
  const label = el('label', labelText, { class:'tool-label' });
  const input = el('textarea', null, { maxlength:'50000', rows:'18' }); input.value = note.body;
  label.append(input); form.append(label);
  const output = el('div', null, { class:'prep-markdown', 'data-prep-markdown':'' });
  if (!editable) { output.innerHTML = prepMarkdown(note.body, { newTab:assignment }); root.append(output); return; }
  const status = el('span', '', { role:'status', 'data-prep-status':'' });
  let saved = note.body, updated = note.updated_at, editing = editable && !assignment && !note.body;
  const savedStatus = () => updated ? `Saved ${new Date(updated).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })}` : '';
  const toggle = button('Edit', () => { editing = !editing; render(); if (editing) input.focus(); });
  const save = button('Save', () => {}); save.type = 'submit';
  const cancel = button('Cancel', () => { input.value = saved; editing = false; render(); });
  const controls = el('div', null, { class:'prep-controls' }); controls.append(toggle, save, status); form.append(controls);
  if (assignment) controls.append(cancel);
  controls.hidden = !editable;
  const render = () => {
    label.hidden = !editing; output.hidden = editing; toggle.textContent = editing ? 'View' : 'Edit';
    if (assignment) { toggle.textContent = 'Edit instructions'; toggle.hidden = editing; save.hidden = !editing; cancel.hidden = !editing; }
    // prepMarkdown emits only escaped text and a small, tested list of elements.
    output.innerHTML = prepMarkdown(input.value, { newTab:assignment });
    status.textContent = input.value !== saved ? 'Unsaved changes' : savedStatus();
    save.disabled = input.value === saved;
  };
  input.addEventListener('input', () => { status.textContent = input.value !== saved ? 'Unsaved changes' : savedStatus(); save.disabled = input.value === saved; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const body = input.value;
    save.disabled = true; input.disabled = true; toggle.disabled = true; cancel.disabled = true; status.textContent = 'Saving…';
    try {
      const row = await backend.saveInstructorNote(note.week, body); saved = row.body; updated = row.updated_at;
      if (assignment) editing = false;
      render();
    } catch (error) { status.textContent = error.message; save.disabled = false; }
    finally { input.disabled = false; toggle.disabled = false; cancel.disabled = false; }
  });
  panel.append(form, output); root.append(panel);
  if (editable) trackPreparationEditor(panel,() => input.value !== saved);
  render();
}

export function renderSpeakers({ root, rows, weeks, backend, confirmInline }) {
  const toolbar = el('div', null, { class:'speakers-toolbar' });
  const add = button('Add speaker', () => { if (!composer.childElementCount) edit(composer); });
  toolbar.append(add);
  const composer = el('div'), list = el('div', null, { class:'speakers-list' }), status = el('p', '', { role:'status' });
  root.append(toolbar, status, composer, list);
  function edit(container, row = {}) {
    const form = el('form', null, { class:'admin-form speaker-form', 'aria-label':row.id ? `Edit ${row.name}` : 'Add speaker' });
    const fields = {};
    for (const key of ['name','affiliation','topic','week','contact','notes']) {
      const label = el('label', key[0].toUpperCase() + key.slice(1), { class:'tool-label' });
      const input = el(key === 'week' ? 'select' : key === 'notes' ? 'textarea' : 'input', null, { 'aria-label':key[0].toUpperCase() + key.slice(1) });
      if (key === 'week') for (const [value,text] of [['','—'], ...Array.from({length:6},(_,i)=>[String(i+1),`Week ${i+1}`])]) input.append(el('option',text,{value}));
      else input.maxLength = SPEAKER_LIMITS[key];
      if (key === 'name') input.required = true;
      input.name = key; input.value = row[key] ?? '';
      fields[key] = input; label.append(input); form.append(label);
    }
    const save = button('Save speaker', () => {}); save.type = 'submit';
    const cancel = button('Cancel', () => { if (row.id) draw(); else { composer.replaceChildren(); add.disabled = false; } });
    const error = el('p', '', { role:'status' }); form.append(save, cancel, error);
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.fromEntries(Object.entries(fields).map(([key,input]) => [key, key === 'week' ? (input.value ? Number(input.value) : null) : input.value]));
      save.disabled = true; cancel.disabled = true;
      try {
        const saved = await backend.saveSpeaker({ ...values, status:row.status || 'Idea', id:row.id });
        rows = rows.filter(s => s.id !== saved.id); rows.push(saved);
        if (!row.id) composer.replaceChildren(); add.disabled = false; draw(); status.textContent = 'Speaker saved.';
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; cancel.disabled = false; }
    });
    container.replaceChildren(form); if (!row.id) add.disabled = true; fields.name.focus();
  }
  function draw() {
    list.replaceChildren();
    const matches = sortedSpeakers(rows, '');
    if (!matches.length) list.append(el('p', 'No speakers found.'));
    for (const week of [...weeks,{week:null,title:'Unscheduled'}]) {
      const group = el('section',null,{class:'speaker-week','data-speaker-week':week.week ?? 'unscheduled'});
      group.append(el('h2',week.week ? `Week ${week.week} · ${week.title}` : week.title));
      const speakers = el('ul',null,{class:'speaker-week-list'}); group.append(speakers); list.append(group);
      for (const row of matches.filter(row => row.week === week.week)) {
        const item = el('li', null, { class:'speaker-row', 'data-speaker-id':row.id });
        // One line per person: name, affiliation, topic, note, then Edit/Delete.
        const heading = el('div', null, { class:'speaker-heading' });
        const url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact) ? `mailto:${row.contact}` : row.contact;
        const name = el('h3', null, { title:row.contact || '' });
        name.append(row.contact && safePrepLink(url) ? el('a', row.name, { href:url, target:'_blank', rel:'noopener noreferrer' }) : document.createTextNode(row.name));
        heading.append(name);
        if (row.affiliation) heading.append(el('span', row.affiliation, { class:'speaker-affiliation' }));
        const detail = el('span', null, { class:'speaker-detail', title:[row.topic, row.notes].filter(Boolean).join(' · ') });
        if (row.topic) detail.append(el('span', row.topic, { class:'speaker-topic' }));
        if (row.notes) detail.append(el('span', row.notes, { class:'speaker-notes' }));
        heading.append(detail);
        const actions = el('div', null, { class:'speaker-actions' });
        const remove = button('Delete', async () => {
          if (!await confirmInline(remove, `Delete ${row.name}?`)) return;
          remove.disabled = true;
          try { await backend.deleteSpeaker(row.id); rows = rows.filter(s => s.id !== row.id); draw(); status.textContent = 'Speaker deleted.'; }
          catch (e) { status.textContent = e.message; remove.disabled = false; }
        });
        actions.append(button('Edit', () => edit(item, row)), remove);
        heading.append(actions); item.append(heading);
        speakers.append(item);
      }
    }
  }
  draw();
}
