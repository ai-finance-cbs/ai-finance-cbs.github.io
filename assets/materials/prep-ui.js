import { prepMarkdown, sortedSpeakers, SPEAKER_STATUSES, SPEAKER_LIMITS, safePrepLink } from './prep-core.js';

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
const dirty = () => editor?.node.isConnected && editor.dirty();
export async function leavePreparation() {
  if (!dirty()) return true;
  if (editor.pending) return false;
  const current = editor;
  return new Promise(resolve => {
    const prompt = el('div', 'Unsaved changes. Leave without saving?', { class:'prep-warning', role:'alert' });
    const finish = value => { prompt.remove(); current.pending = false; if (value) editor = null; resolve(value); };
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

export function renderPreparation({ root, note, backend }) {
  const panel = el('section', null, { class:'preparation-editor' });
  const form = el('form', null, { class:'admin-form prep-form' });
  const label = el('label', `Week ${note.week} notes`, { class:'tool-label' });
  const input = el('textarea', null, { maxlength:'50000', rows:'18' }); input.value = note.body;
  label.append(input); form.append(label);
  const output = el('div', null, { class:'prep-markdown', 'data-prep-markdown':'' });
  const status = el('span', '', { role:'status', 'data-prep-status':'' });
  let saved = note.body, updated = note.updated_at, editing = !note.body;
  const savedStatus = () => updated ? `Saved ${new Date(updated).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })}` : '';
  const toggle = button('Edit', () => { editing = !editing; render(); if (editing) input.focus(); });
  const save = button('Save', () => {}); save.type = 'submit';
  const controls = el('div', null, { class:'prep-controls' }); controls.append(toggle, save, status); form.append(controls);
  const render = () => {
    label.hidden = !editing; output.hidden = editing; toggle.textContent = editing ? 'View' : 'Edit';
    // prepMarkdown emits only escaped text and a small, tested list of elements.
    output.innerHTML = prepMarkdown(input.value);
    status.textContent = input.value !== saved ? 'Unsaved changes' : savedStatus();
    save.disabled = input.value === saved;
  };
  input.addEventListener('input', () => { status.textContent = input.value !== saved ? 'Unsaved changes' : savedStatus(); save.disabled = input.value === saved; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const body = input.value;
    save.disabled = true; input.disabled = true; toggle.disabled = true; status.textContent = 'Saving…';
    try {
      const row = await backend.saveInstructorNote(note.week, body); saved = row.body; updated = row.updated_at;
      render();
    } catch (error) { status.textContent = error.message; save.disabled = false; }
    finally { input.disabled = false; toggle.disabled = false; }
  });
  panel.append(form, output); root.append(panel);
  editor = { node:panel, dirty:() => input.value !== saved, pending:false };
  render();
}

export function renderSpeakers({ root, rows, backend, confirmInline }) {
  const toolbar = el('div', null, { class:'speakers-toolbar' });
  const label = el('label', 'Filter speakers', { class:'tool-label' }), filter = el('input', null, { type:'search' }); label.append(filter);
  const add = button('Add speaker', () => { if (!composer.childElementCount) edit(composer); });
  toolbar.append(label, add);
  const composer = el('div'), list = el('div', null, { class:'speakers-list' }), status = el('p', '', { role:'status' });
  root.append(toolbar, status, composer, list);
  function edit(container, row = {}) {
    const form = el('form', null, { class:'admin-form speaker-form', 'aria-label':row.id ? `Edit ${row.name}` : 'Add speaker' });
    const fields = {};
    for (const key of ['name','affiliation','topic','week','status','contact','notes']) {
      const label = el('label', key[0].toUpperCase() + key.slice(1), { class:'tool-label' });
      const input = el(['week','status'].includes(key) ? 'select' : key === 'notes' ? 'textarea' : 'input', null, { 'aria-label':key[0].toUpperCase() + key.slice(1) });
      if (key === 'week') for (const [value,text] of [['','—'], ...Array.from({length:6},(_,i)=>[String(i+1),`Week ${i+1}`])]) input.append(el('option',text,{value}));
      else if (key === 'status') for (const value of SPEAKER_STATUSES) input.append(el('option',value,{value}));
      else input.maxLength = SPEAKER_LIMITS[key];
      if (key === 'name') input.required = true;
      input.name = key; input.value = row[key] ?? (key === 'status' ? 'Idea' : '');
      fields[key] = input; label.append(input); form.append(label);
    }
    const save = button('Save speaker', () => {}); save.type = 'submit';
    const cancel = button('Cancel', () => { if (row.id) draw(); else { composer.replaceChildren(); add.disabled = false; } });
    const error = el('p', '', { role:'status' }); form.append(save, cancel, error);
    form.addEventListener('submit', async event => {
      event.preventDefault(); const values = Object.fromEntries(Object.entries(fields).map(([key,input]) => [key, key === 'week' ? (input.value ? Number(input.value) : null) : input.value]));
      save.disabled = true; cancel.disabled = true;
      try {
        const saved = await backend.saveSpeaker({ ...values, id:row.id });
        rows = rows.filter(s => s.id !== saved.id); rows.push(saved);
        if (!row.id) composer.replaceChildren(); add.disabled = false; draw(); status.textContent = 'Speaker saved.';
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; cancel.disabled = false; }
    });
    container.replaceChildren(form); if (!row.id) add.disabled = true; fields.name.focus();
  }
  function draw() {
    list.replaceChildren();
    const matches = sortedSpeakers(rows, filter.value);
    if (!matches.length) list.append(el('p', 'No speakers found.'));
    for (const row of matches) {
      const item = el('section', null, { class:'speaker-row', 'data-speaker-id':row.id });
      const heading = el('div', null, { class:'speaker-heading' });
      heading.append(el('h2', row.name));
      for (const key of ['affiliation','topic']) heading.append(el('span', row[key], { class:`speaker-${key}` }));
      heading.append(el('span', row.week ? `Week ${row.week}` : '', { class:'speaker-week' }), el('span', row.status, { class:'speaker-status' }));
      const actions = el('div', null, { class:'speaker-actions' });
      const remove = button('Delete', async () => {
        if (!await confirmInline(remove, `Delete ${row.name}?`)) return;
        remove.disabled = true;
        try { await backend.deleteSpeaker(row.id); rows = rows.filter(s => s.id !== row.id); draw(); status.textContent = 'Speaker deleted.'; }
        catch (e) { status.textContent = e.message; remove.disabled = false; }
      });
      actions.append(button('Edit', () => edit(item, row)), remove);
      const contact = el('span', null, { class:'speaker-contact' }), url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact) ? `mailto:${row.contact}` : row.contact;
      contact.append(safePrepLink(url) ? el('a', row.contact, { href:url, rel:'noopener noreferrer' }) : document.createTextNode(row.contact));
      heading.append(contact, actions); item.append(heading);
      if (row.notes) item.append(el('p', row.notes, { class:'speaker-notes' }));
      list.append(item);
    }
  }
  filter.addEventListener('input', draw); draw();
}
