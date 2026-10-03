import { calendarLinks } from './calendar.js';
import { renderPreparation, renderSpeakers, leavePreparation } from './prep-ui.js';
import { newYorkInput, newYorkTime } from './staff-core.js';
import { gradeCode } from './class-core.js';
import { announcementText } from './upcoming-core.js';
import { renderWeek, renderSubmit } from './week-ui.js';
import { currentWeek, weekSlug, inClassFile } from './week-core.js';
import { CLASS_PAGES, INSTRUCTOR_PAGES, zones, pageAllowed } from './class-core.js';
import { renderClassPage, renderRosterTable, table, wrapTable } from './class-ui.js';
import { OWNER, WEEK_TITLES, ROLE_LABELS, fakeAuthAllowed, isColumbiaEmail, normalizeEmail, parseRoster, safeReturnPath, validatePdf } from './core.js';

const config = window.COURSE_MATERIALS || { base: '', url: '', key: '' };
const root = document.getElementById('materials-root');
// The public course-goals page also offers calendar subscriptions.
const calendarURL = config.url || document.querySelector('[data-calendar-url]')?.dataset.calendarUrl || '';
document.querySelectorAll('[data-calendar-links]').forEach(n=>n.replaceWith(calendarLinks(calendarURL)));
document.body.classList.toggle('class-tools', !!root && ['week', 'landing', ...CLASS_PAGES, ...INSTRUCTOR_PAGES].includes(root.dataset.page));
document.body.classList.toggle('full-tools', !!root && [...CLASS_PAGES, ...INSTRUCTOR_PAGES].includes(root.dataset.page));
const openSettings = new Set();
const dialog = document.getElementById('materials-login');
const message = dialog.querySelector('[data-login-message]');
const state = { backend: null, access: null, version: 0, selectedTerm: null };
let previewRoster = [];
async function startPreview(uni) {
  if (!await leavePreparation()) { document.querySelector('[data-view-select]').value = ''; return; }
  try { await state.backend.setPreview(uni, state.selectedTerm); if (['gradebook', ...INSTRUCTOR_PAGES].includes(root?.dataset.page)) location.assign(path('attendance')); else await refresh(); }
  catch (error) { const status = el('p',error.message,{role:'status'}); (root || document.querySelector('main')).append(status); }
}
const path = name => `${config.base}/materials/${name}/`;
const member = () => state.access && state.access.role !== 'unlisted';
const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const button = (label, click, extra = '') => { const b = el('button', label, { type: 'button', class: `materials-button ${extra}` }); if (click) b.addEventListener('click', click); return b; };
function confirmInline(control, text) {
  return new Promise(resolve => {
    const prompt = el('span', text, { class:'inline-confirm' });
    const finish = value => { prompt.remove(); control.disabled=false; resolve(value); };
    prompt.append(button('Confirm',()=>finish(true)),button('Cancel',()=>finish(false)));
    control.disabled=true;control.after(prompt);
  });
}
function showMessage(text) { message.textContent = text; }
function outlineChanged() {
  document.dispatchEvent(new Event('course:content-changed'));
  if (location.hash) {
    try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Ignore malformed external anchors. */ }
  }
}
function updateModal() {
  dialog.querySelector('[data-login-step]').hidden = !!state.access;
  dialog.querySelector('[data-contact]').hidden = state.access?.role !== 'unlisted';
  if (state.access?.role === 'unlisted') showMessage('You are not on the class list.');
}

// Google Identity Services: Google's own button opens a window that names this site, not the database.
let gsiReady = null;
function loadGsi() {
  gsiReady ||= new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Google sign-in could not load.')); document.head.append(s);
  });
  return gsiReady;
}
async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function setupGsi() {
  const slot = dialog.querySelector('[data-gsi]');
  // Local review uses the demo or the OAuth fallback.
  if (location.hostname === '127.0.0.1' || !config.googleClientId || state.backend?.demo || !state.backend?.signInWithGoogleToken || slot.dataset.ready) return;
  try {
    await loadGsi();
    const raw = crypto.randomUUID() + crypto.randomUUID();
    window.google.accounts.id.initialize({
      client_id: config.googleClientId, nonce: await sha256Hex(raw), ux_mode: 'popup', auto_select: false,
      callback: async ({ credential }) => {
        try {
          if (!sessionStorage.getItem('b8403-return')) sessionStorage.setItem('b8403-return', location.pathname + location.search + location.hash);
          await state.backend.signInWithGoogleToken(credential, raw); await finishSignIn();
        } catch (error) { showMessage(error.message); }
      },
    });
    window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'filled_blue', size: 'large', text: 'continue_with', shape: 'rectangular', width: 300 });
    slot.hidden = false; slot.dataset.ready = '1';
    dialog.querySelector('[data-google]').hidden = true;
    dialog.querySelector('[data-google-fallback]').hidden = false;
  } catch { /* keep the original redirect button */ }
}
function openLogin(destination) {
  if (destination) sessionStorage.setItem('b8403-return', safeReturnPath(destination, location.origin, `${config.base}/`));
  showMessage(''); updateModal();
  if (!dialog.open) dialog.showModal();
  setupGsi();
}
async function finishSignIn() {
  await refresh();
  if (member()) {
    dialog.close();
    const target = sessionStorage.getItem('b8403-return');
    sessionStorage.removeItem('b8403-return');
    if (target) location.assign(safeReturnPath(target, location.origin, `${config.base}/`));
  } else openLogin();
}
function showGate() {
  if (!root) return;
  root.replaceChildren();
  if (!state.access) root.append(el('p', 'Sign in to see course materials.'), button('Sign in with Columbia UNI', () => openLogin()));
  else if (state.access.role === 'unlisted') {
    root.append(el('p', 'You are not on the class list.'), el('p', 'For access, contact the instructor.'), el('a', OWNER, { href: `mailto:${OWNER}` }));
  } else root.append(el('p', INSTRUCTOR_PAGES.includes(root.dataset.page) ? 'This page is for instructors.' : 'Your role does not have access to this page.'));
  outlineChanged();
}
function applyMenu(m) {
  document.querySelectorAll('[data-materials-member]').forEach(n => n.hidden = !m.materials);
  document.querySelectorAll('[data-materials-admin]').forEach(n => n.hidden = !m.instructor);
  document.querySelectorAll('[data-grading-member]').forEach(n => n.hidden = !m.grading);
  document.querySelectorAll('[data-student-only]').forEach(n => n.hidden = !m.student);
  document.querySelectorAll('[data-class-member]').forEach(n => n.hidden = !m.klass);
  // Ed Discussion is for students and staff (TA included), not auditors
  document.querySelectorAll('[data-ed-member]').forEach(n => n.hidden = !m.ed);
  document.querySelectorAll('[data-login]').forEach(n => n.hidden = m.signedIn);
  document.querySelectorAll('[data-signout]').forEach(n => n.hidden = !m.signedIn);
  const badge = document.querySelector('[data-role]');
  badge.hidden = !m.signedIn; badge.textContent = m.role;
}
async function refresh() {
  const version = ++state.version;
  state.access = state.backend ? await state.backend.getAccess() : null;
  if (version !== state.version) return;
  const visible = zones(state.access);
  // Menu visibility only; every page still checks access on the server. The same flags are
  // remembered for this browser tab so the next page can show the menu before sign-in is re-checked.
  const menu = { materials: visible.materials, instructor: visible.instructor, grading: visible.grading,
    student: state.access?.role === 'student', klass: visible.class, ed: visible.class || visible.grading,
    signedIn: !!state.access, role: ROLE_LABELS[state.access?.role] || '' };
  applyMenu(menu);
  try { if (state.access) sessionStorage.setItem('b8403-menu', JSON.stringify(menu)); else sessionStorage.removeItem('b8403-menu'); } catch {}
  const weekCalendar = document.querySelector('[data-week-calendar]');
  if (weekCalendar) {
    weekCalendar.replaceChildren(...(visible.materials ? [calendarLinks(calendarURL)] : []));
    weekCalendar.hidden = !visible.materials;
  }
  updateModal();
  const banner = document.querySelector('[data-preview-banner]');
  banner.hidden = !state.access?.view_as; document.body.classList.toggle('student-preview', !!state.access?.view_as);
  const previewName = state.access?.view_as ? `Viewing as ${state.access.view_as.name}` : '';
  banner.querySelector('[data-preview-name]').textContent = previewName;
  banner.querySelector('[data-preview-name]').title = previewName;
  document.querySelector('[data-demo-tag]').hidden = !state.backend?.demo;
  document.querySelector('[data-view-picker]').hidden = !visible.instructor;
  if (!member()) { showGate(); document.querySelectorAll('[data-slides-status]').forEach(n => n.textContent = ''); return; }
  if (root && !pageAllowed(root.dataset.page, state.access)) { showGate(); return; }
  if (root) { root.onclick=null;root.replaceChildren(el('p', 'Loading course materials…')); }
  try {
    if (location.pathname === `${config.base}/` || root?.dataset.page === 'landing') {
      const sessions = await state.backend.sessions();
      if (version !== state.version) return;
      sessionStorage.removeItem('b8403-return');
      state.redirecting = true;
      location.replace(path(weekSlug(currentWeek(sessions))));
      return;
    } else if (root?.dataset.page === 'week') {
      const data = await state.backend.classData();
      if (version !== state.version) return;
      root.replaceChildren();
      renderWeek({ root, data, access: state.access, backend: state.backend, refresh, path, fileLink });
      outlineChanged();
    } else if (root && ['preparation','speakers'].includes(root.dataset.page)) {
      const prep = root.dataset.page === 'preparation';
      const data = prep ? await state.backend.instructorNote(Number(root.dataset.week)) : await state.backend.speakers();
      if (version !== state.version) return;
      root.replaceChildren();
      if (prep) renderPreparation({ root, note:data, backend:state.backend });
      else renderSpeakers({ root, rows:data, backend:state.backend, confirmInline });
      outlineChanged();
    } else if (root && [...CLASS_PAGES, ...INSTRUCTOR_PAGES].includes(root.dataset.page)) {
      const page = root.dataset.page;
      const chooseTerm = ['instructor','grader'].includes(state.access.role) && ['gradebook','attendance','roster'].includes(page);
      const terms = chooseTerm ? await state.backend.terms() : [];
      const term = chooseTerm ? state.selectedTerm || state.access.term_id : state.access.term_id;
      const data = await state.backend.classData(term);
      if (version !== state.version) return;
      const pageAccess = { ...state.access, read_only: state.access.read_only || term !== state.access.term_id };
      root.replaceChildren();
      if (chooseTerm) {
        const label = el('label', 'Term', { class:'term-filter' }), select = el('select',null,{'aria-label':'Term'});
        for (const t of terms) select.append(el('option',`${t.title}${t.status==='active'?'':' · Read-only'}`,{value:t.id}));
        select.value=term; label.append(select); root.append(label);
        select.addEventListener('change',()=>{state.selectedTerm=select.value;refresh();});
      }
      if (page === 'submit') renderSubmit({ root, data, access: state.access, backend: state.backend, refresh, path });
      else if (CLASS_PAGES.includes(page) || page === 'gradebook') renderClassPage({ root, page, data, backend: state.backend, access: pageAccess, refresh, startPreview });
      else {
        root.append(el('p', '', { class: 'materials-status', 'data-admin-status': '', role: 'status' }));
        if (page === 'roster') {
          const admin = await state.backend.adminData(); if (version !== state.version) return;
          renderRosterTable({ root, data, startPreview, access:pageAccess, backend:state.backend, refresh });
          if (!pageAccess.read_only) renderRoster(admin.roster);
        } else if (page === 'files') {
          const files = await state.backend.files(); if (version !== state.version) return; renderFileAdmin(files);
        } else if (page === 'settings') {
          const [admin, assignments, tests, announcements, overview] = await Promise.all([state.backend.adminData(), state.backend.assignments(), state.backend.testAccounts(), state.backend.announcements(), state.backend.staffOverview()]);
          if (version !== state.version) return;
          renderScheduleAdmin(data);
          renderGroupSettings(data);
          renderFileAdmin(data.files);
          root.append(el('p', `Storage: ${(overview.storage_bytes / 1024 / 1024).toFixed(1)} MB used / 1 GB`, { 'data-storage-usage': '' }));
          renderTermAdmin(overview);
          renderAnnouncementAdmin(announcements);
          renderAllowlist(admin.allowlist); renderAssignmentAdmin(assignments);
          const links = await state.backend.studentAccounts(); if(version !== state.version) return; renderStudentAccounts(links);
          const testSection = section('Test accounts', 'test-accounts');
          testSection.append(el('p', 'These accounts have fixed test access. This list is read-only.'));
          const list = el('ul'); for (const t of tests) list.append(el('li', `${t.email} · ${ROLE_LABELS[t.role]}${t.uni ? ` · ${t.uni}` : ''}`));
          testSection.append(list);
        }
      }
      outlineChanged();
    }
    if (visible.instructor) {
      const data = await state.backend.classData(); if (version !== state.version) return;
      previewRoster = data.roster;
      const select = document.querySelector('[data-view-select]'); select.replaceChildren(el('option', 'View as student', { value: '' }));
      for (const r of previewRoster) select.append(el('option', `${r.name || r.uni} (${r.uni})`, { value: r.uni }));
    }
    if (document.querySelector('[data-week-slides]')) {
      const rows = await state.backend.files(); if (version !== state.version) return;
      document.querySelectorAll('[data-slides-status]').forEach(n => { n.textContent = rows.some(f => f.week === Number(n.dataset.slidesStatus) && !inClassFile(f)) ? '' : 'Posted after class.'; });
    }
  } catch (error) {
    if (version !== state.version) return;
    if (root) root.replaceChildren(el('p', `Could not load materials. ${error.message}`), button('Try again', () => refresh()));
    else console.warn('Course materials could not load.');
  }
}
function fileLink(file) {
  const a = el('a', file.title, { href: '#', 'data-file-id': file.id });
  a.addEventListener('click', async e => {
    e.preventDefault(); const old = a.textContent; a.textContent = 'Preparing PDF…';
    try {
      const url = await state.backend.fileUrl(file.id);
      const download = el('a', null, { href: url, download: `${file.title}.pdf`, rel: 'noreferrer' });
      document.body.append(download); download.click(); download.remove();
    } catch (error) {
      let status = a.parentElement.querySelector('[data-file-error]');
      if (!status) { status = el('span', '', { role: 'status', 'data-file-error': '' }); a.after(status); }
      status.textContent = `Could not open this file. ${error.message}`;
    }
    finally { a.textContent = old; }
  });
  return a;
}

function field(form, label, name, value = '', type = 'text') {
  const id = `${form.id}-${name}`; const l = el('label', label, { for: id });
  const input = el(type === 'textarea' ? 'textarea' : 'input', null, { id, name });
  if (type !== 'textarea') input.type = type;
  if (type === 'checkbox') { l.className = 'check-label'; input.checked = !!value; l.prepend(input); form.append(l); }
  else { input.value = value; l.className = 'tool-label'; l.append(input); form.append(l); }
  return input;
}
function formStatus(form) { const status = el('p', '', { class: 'materials-status', role: 'status' }); form.append(status); return status; }
async function runAction(control, status, task, success, rerender = false) {
  control.disabled = true; status.textContent = 'Working…';
  try { await task(); if (rerender) { await refresh(); const current = root.querySelector('[data-admin-status]'); if (current) current.textContent = success; } else status.textContent = success; }
  catch (error) { status.textContent = error.message || 'The change could not be saved. Try again.'; }
  finally { control.disabled = false; }
}
function section(title, id) {
  const collapsible = root.dataset.page === 'settings';
  const s = el(collapsible ? 'details' : 'section', null, { class: 'admin-section', id });
  s.append(el(collapsible ? 'summary' : 'h2', title));
  if (collapsible) {
    s.open = openSettings.has(id);
    s.addEventListener('toggle', () => { if (s.open) openSettings.add(id); else openSettings.delete(id); });
  }
  root.append(s); return s;
}
function newForm(id) { return el('form', null, { class: 'admin-form', id }); }
function renderRoster(roster) {
  const s = el('details', null, { class: 'tool-disclosure', id: 'class-roster' });
  s.append(el('summary', 'Replace roster from Canvas CSV')); root.append(s);
  s.append(el('p', `${roster.length} ${roster.length === 1 ? 'student' : 'students'} on the class list. Upload a Canvas People CSV to replace the roster.`));
  const form = newForm('roster-form'); const upload = field(form, 'Canvas roster CSV', 'csv', '', 'file'); upload.accept = '.csv,text/csv'; upload.required = true;
  const previewButton = button('Preview roster'); previewButton.type = 'submit'; const status = formStatus(form); const preview = el('div'); form.append(previewButton, preview);
  form.addEventListener('submit', e => {
    e.preventDefault(); runAction(previewButton, status, async () => {
      preview.replaceChildren();
      const file = upload.files[0]; if (!file || file.size > 1_000_000) throw new Error('Choose a CSV smaller than 1 MB.');
      const result = parseRoster(await file.text());
      preview.append(el('p', `${result.rows.length} valid students. ${result.issues.length} rows need attention.`));
      const wrap = el('div', null, { class: 'roster-preview' }); const table = el('table'); const head = el('tr'); head.append(el('th', 'Student'), el('th', 'UNI')); const thead = el('thead'); thead.append(head); const body = el('tbody');
      for (const row of result.rows) { const tr = el('tr'); tr.append(el('td', row.name || '—'), el('td', row.uni)); body.append(tr); }
      table.append(thead, body); wrap.append(table); preview.append(wrap);
      for (const issue of result.issues) preview.append(el('p', `Row ${issue.row}: ${issue.name || '(no name)'} · ${issue.reason}`));
      if (result.errors.length) { preview.append(el('p', result.errors.join(' '))); return; }
      const acknowledge = el('input', null, { type: 'checkbox', id: 'roster-confirm' }); const label = el('label', `Replace all ${roster.length} current roster entries with these ${result.rows.length} students${result.issues.length ? ' and skip the flagged rows' : ''}.`, { for: 'roster-confirm', class: 'check-label' }); label.prepend(acknowledge); preview.append(label);
      const save = button('Replace roster', () => runAction(save, status, () => state.backend.replaceRoster(result.rows), `Roster replaced: ${result.rows.length} students.`, true)); save.disabled = true;
      acknowledge.addEventListener('change', () => save.disabled = !acknowledge.checked); preview.append(save);
      upload.addEventListener('change', () => preview.replaceChildren(), { once: true });
    }, 'Preview ready. Review every flagged row before replacing the roster.');
  });
  s.append(form);
}
function renderAnnouncementAdmin(rows) {
  const s = section('Announcements', 'announcements-editor');
  const editor = row => {
    const form = newForm(`announcement-${row?.id || 'new'}`);
    const title = field(form, 'Title (optional)', 'title', row?.title || ''); title.maxLength = 200;
    const body = field(form, 'Announcement text', 'body', row?.body || '', 'textarea'); body.maxLength = 2000; body.required = true;
    const save = button(row ? 'Save announcement' : 'Post announcement'); save.type = 'submit';
    form.append(save);
    const status = formStatus(form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      runAction(save, status, () => state.backend.saveAnnouncement({ ...announcementText({ title: title.value, body: body.value }), ...(row ? { id: row.id } : {}) }), row ? 'Announcement saved.' : 'Announcement posted.', true);
    });
    if (row) {
      form.append(el('time', new Date(row.created_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' }), { datetime: row.created_at }));
      const remove = button('Delete announcement', async () => {
        if (await confirmInline(remove, 'Delete this announcement?')) runAction(remove, status, () => state.backend.deleteAnnouncement(row.id), 'Announcement deleted.', true);
      });
      form.append(remove);
    }
    return form;
  };
  s.append(editor(null));
  for (const row of rows) {
    const details = el('details', null, { class: 'announcement-editor' });
    details.append(el('summary', row.title || row.body.slice(0, 80)), editor(row)); s.append(details);
  }
}
function renderStudentAccounts(rows) {
  const s=section('CBS account links','student-accounts'), form=newForm('student-account-form');
  s.append(el('p','Link a verified CBS email to its roster UNI. Students cannot claim another student’s UNI.'));
  const email=field(form,'CBS student email','student_email','', 'email'), uni=field(form,'Roster UNI','student_uni','');
  email.required=true;uni.required=true;const save=button('Link student account');save.type='submit';form.append(save);const status=formStatus(form);
  form.addEventListener('submit',e=>{e.preventDefault();runAction(save,status,()=>state.backend.linkStudent(email.value.trim().toLowerCase(),uni.value.trim().toLowerCase()),'Student account linked.',true);});s.append(form);
  const list=el('ul');for(const row of rows){const li=el('li',`${row.email} · ${row.uni} `);const remove=button(`Remove link for ${row.email}`,()=>runAction(remove,status,()=>state.backend.linkStudent(row.email,null),'Account link removed.',true));li.append(remove);list.append(li);}s.append(list);
}
function renderAllowlist(rows) {
  const s = section('Role access', 'access-lists'); const form = newForm('allowlist-form');
  const email = field(form, 'Columbia email', 'email', '', 'email'); email.required = true; email.maxLength = 254;
  const label = el('label', 'Access role', { for: 'allow-role' }); const select = el('select', null, { id: 'allow-role' });
  select.append(el('option', 'Instructor', { value: 'instructor' }), el('option', 'Grader', { value: 'grader' }), el('option', 'Auditor', { value: 'auditor' })); label.className = 'tool-label'; label.append(select); form.append(label);
  const save = button('Save access'); save.type = 'submit'; const status = formStatus(form); form.append(save);
  form.addEventListener('submit', e => { e.preventDefault(); runAction(save, status, async () => {
    const normalized = normalizeEmail(email.value); if (!isColumbiaEmail(normalized)) throw new Error('Use an @columbia.edu or @gsb.columbia.edu email.');
    if (normalized === OWNER) throw new Error('The instructor account is fixed.');
    if (normalized === state.access.email && select.value !== 'instructor' && !await confirmInline(save, `Change your own role to ${ROLE_LABELS[select.value]}? You will lose instructor access.`)) throw new Error('Your role was not changed.');
    await state.backend.saveAllowlist({ email: normalized, role: select.value });
  }, 'Access saved.', true); });
  s.append(form); const list = el('ul', null, { class: 'file-list' });
  for (const row of rows) {
    const li = el('li'); li.append(el('span', row.email), el('span', ROLE_LABELS[row.role], { class: 'file-meta' }));
    if (row.email !== OWNER) { const remove = button(`Remove ${row.email}`, async () => { if (await confirmInline(remove, `Remove access for ${row.email}?`)) runAction(remove, status, () => state.backend.removeAllowlist(row.email), 'Access removed.', true); }); li.append(remove); }
    list.append(li);
  }
  s.append(list);
}
function renderScheduleAdmin(data) {
  const sessions = section('Session times', 'session-times');
  for (const session of data.sessions.filter(s => s.week >= 1 && s.week <= 6)) {
    const form = newForm(`session-${session.week}`);
    form.append(el('h3', `Week ${session.week}`));
    const start = field(form, `Week ${session.week} start (New York)`, 'start', newYorkInput(session.starts_at), 'datetime-local');
    const end = field(form, `Week ${session.week} end (New York)`, 'end', newYorkInput(session.ends_at), 'datetime-local');
    const save = button(`Save Week ${session.week} times`); save.type = 'submit';
    form.append(save); const status = formStatus(form);
    form.addEventListener('submit', e => { e.preventDefault(); runAction(save, status, () => state.backend.setSessionTimes(session.week, newYorkTime(start.value), newYorkTime(end.value)), 'Session times saved.'); });
    sessions.append(form);
  }
  const items = section('Submission settings', 'submission-settings');
  for (const item of data.items.filter(i => i.kind !== 'none')) {
    const details = el('details'); details.append(el('summary', `${gradeCode(item)} · ${item.title}`));
    const form = newForm(`item-${item.id}`);
    const due = field(form, 'Due time (New York)', 'due', newYorkInput(item.due_at), 'datetime-local');
    const modeLabel = el('label', 'Submission mode', { class:'tool-label' }), mode = el('select', null, { 'aria-label': 'Submission mode' });
    for (const value of ['individual','group']) mode.append(el('option', value === 'group' ? 'Group' : 'Individual', { value }));
    mode.value = item.mode; modeLabel.append(mode); form.append(modeLabel);
    const setLabel = el('label', 'Linked group set', { class:'tool-label' }), set = el('select', null, { 'aria-label':'Linked group set' });
    set.append(el('option','Choose a group set',{value:''}));
    for (const row of data.sets) set.append(el('option', row.title, {value:row.id}));
    set.value = item.group_set_id || ''; set.disabled = mode.value !== 'group';
    mode.addEventListener('change', () => { set.disabled = mode.value !== 'group'; });
    setLabel.append(set); form.append(setLabel);
    const save = button(`Save ${gradeCode(item)} settings`); save.type='submit'; form.append(save); const status=formStatus(form);
    form.addEventListener('submit', e => { e.preventDefault(); runAction(save,status,async()=>{
      if(mode.value === 'group' && !set.value) throw new Error('Choose a group set for group submissions.');
      await state.backend.configureItem(item.id,{kind:item.kind,mode:mode.value,group_set_id:mode.value==='group'?set.value:null,due_at:newYorkTime(due.value)});
    },'Submission settings saved.',true); });
    details.append(form); items.append(details);
  }
}
function renderGroupSettings(data) {
  const sectionNode=section('Group sign-up settings','group-settings');
  if(!data.sets.length)sectionNode.append(el('p','Create a group set on Groups first.'));
  for(const set of data.sets) {
    const form=newForm(`group-note-${set.id}`);form.append(el('h3',set.title));
    const note=field(form,'Sign-up note','note',set.note || '');note.maxLength=500;
    const save=button('Save sign-up note');save.type='submit';form.append(save);const status=formStatus(form);
    form.addEventListener('submit',e=>{e.preventDefault();runAction(save,status,()=>state.backend.setGroupNote(set.id,note.value),'Sign-up note saved.');});
    const addForm=newForm(`group-add-${set.id}`);
    addForm.append(el('p',`${data.groups.filter(g=>g.set_id===set.id).length} groups`));
    const count=field(addForm,'Number of groups to add','count',1,'number');count.min=1;count.max=100;count.required=true;
    const add=button('Add groups');add.type='submit';addForm.append(add);const addStatus=formStatus(addForm);
    addForm.addEventListener('submit',e=>{e.preventDefault();runAction(add,addStatus,()=>state.backend.addGroups(set.id,Number(count.value)),'Groups added.',true);});
    sectionNode.append(form,addForm);
  }
}
function renderTermAdmin(overview) {
  const sectionNode=section('Term rollover', 'term-rollover');
  const active=overview.terms.find(t=>t.status==='active');
  sectionNode.append(el('p',`Active term: ${active?.title || 'None'}`));
  const form=newForm('open-term'),name=field(form,'New term name','name');name.required=true;name.maxLength=100;
  const approve=field(form,'Archive the current term and open the new term','confirm',false,'checkbox');approve.required=true;
  const open=button('Open term');open.type='submit';form.append(open);const status=formStatus(form);
  form.addEventListener('submit',e=>{e.preventDefault();if(approve.checked)runAction(open,status,()=>state.backend.openTerm(name.value.trim()),'New term opened.',true);});
  sectionNode.append(form);
  for(const term of overview.terms.filter(t=>t.status!=='active')) {
    const row=el('section',null,{id:`term-${term.id}`,class:'term-actions','data-term':term.id});row.append(el('h3',term.title),el('p',term.status));
    const progress=formStatus(row);
    const exportButton=button('Export grades and submissions',()=>runAction(exportButton,progress,async()=>{
      await state.backend.exportTerm(term.id,text=>{progress.textContent=text;});
    },'Export ready. Save the downloaded ZIP before closing this term.',true));
    if(term.status==='archived-readable') {
      row.append(exportButton);
      const confirmed=field(row,'I saved the export; end student access','saved-export',false,'checkbox');
      const close=button('Close previous term',()=>runAction(close,progress,()=>state.backend.closePreviousTerm(term.id),'Term closed. Purge remains a separate action.',true));
      close.disabled=true;confirmed.addEventListener('change',()=>close.disabled=!confirmed.checked || !term.exported_at);
      row.append(close);
      if(term.exported_at) {
        row.append(el('p',`Export recorded ${new Date(term.exported_at).toLocaleDateString('en-US',{timeZone:'America/New_York'})} · ${term.file_count} files · ${formatBytes(term.byte_count)}`,{'data-export-summary':''}));
        if(term.missing_files?.length)row.append(el('p',`${term.missing_files.length} files missing`,{'data-missing-files':''}));
      }
    } else if(!term.purged_at) {
      const confirmed=field(row,'Delete this closed term’s stored files','purge-confirm',false,'checkbox');
      const purge=button('Purge stored files',()=>runAction(purge,progress,()=>state.backend.purgeTerm(term.id),'Stored files purged. Audit metadata retained.',true));
      purge.disabled=true;confirmed.addEventListener('change',()=>purge.disabled=!confirmed.checked);row.append(purge);
    } else row.append(el('p','Stored files purged.'));
    sectionNode.append(row);
  }
}

function formatBytes(bytes) {
  return bytes<1024 ? `${bytes} bytes` : bytes<1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`;
}
function renderOrphanTools(parent) {
  const results=el('div',null,{'data-orphan-files':''}),status=formStatus(results);
  const scan=button('List unreferenced files',()=>runAction(scan,status,async()=>{
    const files=await state.backend.lectureOrphans();results.replaceChildren(status);
    results.append(el('p',`${files.length} unreferenced files`));
    if(!files.length)return;
    const list=el('ul');for(const file of files)list.append(el('li',`${file.path}${file.size==null?'':` · ${formatBytes(file.size)}`}`));results.append(list);
    const remove=button('Delete listed files',async()=>{
      if(!await confirmInline(remove,`Delete these ${files.length} unreferenced files?`))return;
      runAction(remove,status,async()=>{for(const file of files)await state.backend.cleanupLectureOrphan(file.path);results.replaceChildren(status);},'Unreferenced files deleted.',true);
    });results.append(remove);
  },'File list ready.'));
  parent.append(scan,results);
}
function renderFileAdmin(files) {
  const s = section('Files', 'lecture-pdfs');
  const form = newForm('file-form');
  const weekLabel = el('label', 'Week', { for: 'upload-week' }); const week = el('select', null, { id: 'upload-week', name: 'week', 'aria-label': 'Week' }); WEEK_TITLES.forEach((title, i) => week.append(el('option', `Week ${i + 1}: ${title}`, { value: i + 1 })));
  weekLabel.className = 'tool-label'; weekLabel.append(week); form.append(weekLabel);
  const title = field(form, 'File title', 'title'); title.required = true; title.maxLength = 200;
  const categoryLabel = el('label', 'File category', { for: 'upload-category', class: 'tool-label' });
  const category = el('select', null, { id: 'upload-category', name: 'category' });
  category.append(el('option', 'Lecture notes', { value: 'notes' }), el('option', 'In-class files', { value: 'in_class' }));
  categoryLabel.append(category); form.append(categoryLabel);
  const file = field(form, 'Lecture PDF (maximum 20 MB)', 'pdf', '', 'file'); file.accept = '.pdf,application/pdf'; file.required = true;
  const visible = field(form, 'Visible to auditors', 'auditor_visible', false, 'checkbox');
  const released = field(form, 'Released now', 'released', true, 'checkbox');
  const releaseAt = field(form, 'Release time (New York)', 'release_at', '', 'datetime-local');
  category.addEventListener('change', () => { released.checked = category.value === 'notes'; });
  releaseAt.addEventListener('change', () => { if (releaseAt.value) released.checked = false; });
  const upload = button('Upload PDF'); upload.type = 'submit'; const status = formStatus(form); form.append(upload);
  form.addEventListener('submit', e => { e.preventDefault(); runAction(upload, status, async () => {
    await validatePdf(file.files[0]); if (!title.value.trim()) throw new Error('Enter a file title.');
    await state.backend.uploadFile(file.files[0], { title: title.value.trim(), week: Number(week.value), category: category.value, auditor_visible: visible.checked, released: released.checked, release_at: newYorkTime(releaseAt.value) });
  }, 'PDF uploaded.', true); });
  s.append(form); const { t, body } = table(['File', 'Week', 'Category', 'Access', 'Actions']);
  for (const row of files) {
    const tr = el('tr'), name = el('th', null, { scope: 'row' }), actions = el('td');
    name.append(fileLink(row));
    const toggle = button(row.auditor_visible ? `Hide ${row.title} from auditors` : `Share ${row.title} with auditors`, () => runAction(toggle, status, () => state.backend.setFileVisibility(row.id, !row.auditor_visible), 'File visibility updated.', true));
    const remove = button(`Delete ${row.title}`, async () => { if (await confirmInline(remove, `Delete ${row.title}? This removes its stored PDF.`)) runAction(remove, status, () => state.backend.deleteFile(row.id), 'PDF deleted.', true); });
    toggle.setAttribute('aria-label', toggle.textContent); toggle.textContent = row.auditor_visible ? 'Hide from auditors' : 'Share with auditors';
    remove.setAttribute('aria-label', remove.textContent); remove.textContent = 'Delete';
    const schedule = el('input', null, { type: 'datetime-local', 'aria-label': `${row.title} release time (New York)` }); schedule.value = newYorkInput(row.release_at);
    const saveRelease = button('Save release time', () => runAction(saveRelease, status, () => state.backend.setFileRelease(row.id, schedule.value ? false : row.released, newYorkTime(schedule.value)), 'Release time saved.', true));
    actions.append(schedule, saveRelease, toggle, remove);
    tr.append(name, el('td', row.week), el('td', row.category === 'in_class' ? 'In-class files' : 'Lecture notes'), el('td', row.auditor_visible ? 'Auditors included' : 'Class only'), actions);
    body.append(tr);
  }
  if (files.length) s.append(wrapTable(t));
  else s.append(el('p', 'No lecture PDFs uploaded.', { class: 'tool-help' }));
  renderOrphanTools(s);
}
function renderAssignmentAdmin(rows) {
  const s = section('Assignment text and access', 'assignment-editor');
  s.append(el('p', 'Plain text only. Line breaks are preserved.'));
  if (!rows.length) s.append(el('p', 'No assignments found. Load the private seed in Supabase using SETUP.md.'));
  for (const row of rows) {
    const details = el('details'); details.append(el('summary', `${row.id === 6 ? 'Final Prototype' : `Milestone #${row.id}`} · ${row.title}`));
    const form = newForm(`assignment-${row.id}`);
    const title = field(form, 'Title', 'title', row.title); title.required = true; title.maxLength = 200;
    const due = field(form, 'Due', 'due', row.due); due.required = true; due.maxLength = 100;
    const points = field(form, 'Points', 'points', row.points, 'number'); points.required = true; points.min = '0'; points.max = '100'; points.step = '1';
    const description = field(form, 'Description', 'description', row.description, 'textarea'); description.maxLength = 20000;
    const deliverable = field(form, 'Deliverable', 'deliverable', row.deliverable, 'textarea'); deliverable.maxLength = 10000;
    const grading = field(form, 'How it is graded', 'grading', row.grading, 'textarea'); grading.maxLength = 10000;
    const visible = field(form, 'Visible to auditors', 'auditor_visible', row.auditor_visible, 'checkbox');
    const save = button('Save assignment'); save.type = 'submit'; const status = formStatus(form); form.append(save);
    form.addEventListener('submit', e => { e.preventDefault(); runAction(save, status, () => state.backend.saveAssignment({ id: row.id, title: title.value.trim(), due: due.value.trim(), points: Number(points.value), description: description.value, deliverable: deliverable.value, grading: grading.value, auditor_visible: visible.checked }), 'Assignment saved.'); });
    details.append(form); s.append(details);
  }
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-login]')) openLogin();
  const link = e.target.closest('[data-protected-link]');
  if (link && !member()) { e.preventDefault(); openLogin(link.href); }
});
dialog.querySelector('[data-close-login]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
document.querySelector('[data-view-select]').addEventListener('change', e => { if (e.target.value) startPreview(e.target.value); });
document.querySelector('[data-preview-exit]').addEventListener('click', () => startPreview(null));
document.querySelector('[data-signout]').addEventListener('click', async () => {
  if (!await leavePreparation()) return;
  ++state.version; state.access = null; showGate(); sessionStorage.removeItem('b8403-return');
  try { sessionStorage.removeItem('b8403-menu'); } catch {}
  try { await state.backend?.signOut(); await refresh(); }
  catch (error) { openLogin(); showMessage(`Sign out could not finish. ${error.message}`); }
});
dialog.querySelector('[data-google-fallback]').addEventListener('click', () => dialog.querySelector('[data-google]').click());
dialog.querySelector('[data-google]').addEventListener('click', async e => {
  e.target.disabled = true;
  try {
    if (state.backend?.demo) { showMessage('Choose a local demo role below. Real Google sign-in is disabled in demo mode.'); return; }
    if (!state.backend) throw new Error('Course sign-in is not configured yet. Contact oh@gsb.columbia.edu.');
    const returnTo = location.pathname + location.search + location.hash;
    if (!sessionStorage.getItem('b8403-return')) sessionStorage.setItem('b8403-return', returnTo);
    // Google returns to the exact public page. The saved local path restores its anchor.
    await state.backend.signIn(location.origin + location.pathname);
  } catch (error) { showMessage(error.message); }
  finally { e.target.disabled = false; }
});
async function init() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('fakeauth');
  const localDemo = fakeAuthAllowed(location) && (requested || sessionStorage.getItem('b8403-demo-enabled'));
  try {
    if (localDemo) {
      const { createDemo } = await import('./demo.js'); state.backend = createDemo(); sessionStorage.setItem('b8403-demo-enabled', '1');
      dialog.querySelector('[data-demo-controls]').hidden = false;
      if (requested) {
        await state.backend.pickRole(requested);
        params.delete('fakeauth'); history.replaceState({}, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
      }
      dialog.querySelector('[data-demo-enter]').addEventListener('click', async () => { await state.backend.pickRole(dialog.querySelector('#demo-role').value); await finishSignIn(); });
    } else if (config.url && config.key) {
      const { createBackend } = await import('./supabase.js'); state.backend = await createBackend(config);
    }
    await refresh();
    state.backend?.onSignOut?.(() => {
      ++state.version; state.access = null; showGate();
      refresh().catch(() => { state.access = null; showGate(); });
    });
    const oauthError = params.get('error_description');
    if (oauthError) { openLogin(); showMessage('Google sign-in was cancelled or could not finish. Please try again.'); }
    else if (params.has('code') || sessionStorage.getItem('b8403-return')) {
      if (member()) await finishSignIn(); else if (state.access) openLogin();
    }
  } catch (error) { state.access = null; showGate(); openLogin(); showMessage(error.message); }
  finally { if (!state.redirecting) document.documentElement.dataset.materialsReady = 'true'; }
}
init();
