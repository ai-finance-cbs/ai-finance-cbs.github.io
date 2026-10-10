import { renderAssignments } from './assignment-ui.js';
import { loadCanvas, renderCanvasGrades, renderCanvasGroups } from './canvas-student-ui.js';
import { renderCanvasSettings, renderCanvasMode, renderCanvasRoster } from './canvas-ui.js';
import { ASSIGNMENT_CODES } from './assignment-core.js';
import { renderSpeakers, leavePreparation } from './prep-ui.js';
import { renderPreparationOutline } from './prep-outline-ui.js';
import { newYorkInput, newYorkTime } from './staff-core.js';
import { announcementText } from './upcoming-core.js';
import { renderWeek } from './week-ui.js';
import { currentWeek, weekSlug, inClassFile } from './week-core.js';
import { CLASS_PAGES, INSTRUCTOR_PAGES, zones, pageAllowed } from './class-core.js';
import { renderClassPage, renderArchivedRecords, renderRosterTable, table, wrapTable } from './class-ui.js';
import { OWNER, WEEK_TITLES, ROLE_LABELS, fakeAuthAllowed, isColumbiaEmail, normalizeEmail, safeReturnPath, validatePdf } from './core.js';

const config = window.COURSE_MATERIALS || { base: '', url: '', key: '' };
const root = document.getElementById('materials-root');
document.body.classList.toggle('class-tools', !!root && ['week', 'landing', 'assignments', ...CLASS_PAGES, ...INSTRUCTOR_PAGES].includes(root.dataset.page));
// Every class and staff tool stays in the right pane; the left pane is never covered.
const openSettings = new Set();
const dialog = document.getElementById('materials-login');
const message = dialog.querySelector('[data-login-message]');
let savedTerm = null; try { savedTerm = localStorage.getItem('b8403-term'); } catch {}
const state = { backend: null, access: null, version: 0, selectedTerm: savedTerm };
// Staff pick the term in the header (next to the course title); term-aware pages load that term.
const TERM_PAGES = ['gradebook', 'attendance', 'roster', 'groups', 'settings'];
async function headerTerm(version) {
  const label = document.querySelector('.brand-term'); if (!label) return;
  document.querySelector('.term-switch')?.remove(); label.hidden = false;
  if (!['instructor', 'grader'].includes(state.access?.role) || document.body.classList.contains('standalone-tool')) return;
  let terms = []; try { terms = await state.backend.terms(); } catch { return; }
  if(version !== state.version)return;
  if (!terms.some(t => t.id === state.selectedTerm)) state.selectedTerm = state.access.term_id;
  const select = el('select', null, { class: 'term-switch', 'aria-label': 'Term' });
  for (const t of terms) select.append(el('option', `${t.title}${t.status === 'active' ? '' : ' · Read-only'}`, { value: t.id }));
  select.value = state.selectedTerm;
  select.addEventListener('change', () => { state.selectedTerm = select.value; try { localStorage.setItem('b8403-term', select.value); } catch {} refresh(); });
  label.hidden = true; label.closest('.brand-heading').querySelector('.course-brand').after(select);
}
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
// Loading state: the course paperclip bobbing above a short label.
const loader = (text = 'Loading…') => { const box = el('div', null, { class: 'course-loader', role: 'status' }); box.append(el('img', null, { src: `${config.base || ''}/assets/loader-clip.png`, alt: '', width: '72', height: '72' }), el('span', text)); return box; };
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
  document.querySelectorAll('[data-assignments-member]').forEach(n => n.hidden = !m.assignments);
  document.querySelectorAll('[data-assignment-nav]').forEach(n => n.hidden = !(m.assignmentCodes || []).some(code => n.dataset.assignmentNav === 'optional' ? code.startsWith('O') : code === n.dataset.assignmentNav));
  document.querySelectorAll('[data-materials-admin]').forEach(n => n.hidden = !m.instructor);
  document.querySelectorAll('[data-grading-member]').forEach(n => n.hidden = !m.grading);
  document.querySelectorAll('[data-student-only]').forEach(n => n.hidden = !m.student);
  document.querySelectorAll('[data-class-member]').forEach(n => n.hidden = !m.klass);
  // Ed Discussion is for students and staff (TA included), not auditors
  document.querySelectorAll('[data-ed-member]').forEach(n => n.hidden = !m.ed);
  document.querySelectorAll('[data-login]').forEach(n => n.hidden = m.signedIn);
  document.querySelectorAll('[data-signout]').forEach(n => n.hidden = !m.signedIn);
  document.documentElement.toggleAttribute('data-signed-in', !!m.signedIn);
  const badge = document.querySelector('[data-role]');
  badge.hidden = !m.signedIn; badge.textContent = m.role;
  // Greeting before the role badge: "Welcome back, Jane!" (first name from Google sign-in, or the previewed student).
  const greeting = document.querySelector('[data-greeting]');
  if (greeting) { greeting.hidden = !m.signedIn; greeting.textContent = m.signedIn ? (m.firstName ? `Welcome back, ${m.firstName}!` : 'Welcome back!') : ''; }
}
async function refresh() {
  const version = ++state.version;
  document.documentElement.dataset.materialsReady = 'false';
  try { await renderMaterials(version); }
  finally {
    if(version === state.version && !state.redirecting)document.documentElement.dataset.materialsReady = 'true';
  }
}
async function renderMaterials(version) {
  state.access = state.backend ? await state.backend.getAccess() : null;
  if (version !== state.version) return;
  const visible = zones(state.access);
  const roleMenu = { materials: visible.materials, instructor: visible.instructor, grading: visible.grading,
    student: state.access?.role === 'student', klass: visible.class || visible.grading, ed: visible.class || visible.grading,
    signedIn: !!state.access, role: ROLE_LABELS[state.access?.role] || '',
    firstName: (state.access?.view_as?.name || state.access?.first_name || '').trim().split(/\s+/)[0] || '' };
  // Show the role's menu as soon as sign-in resolves; the Assignments tab waits for its list.
  let cached = null; try { cached = JSON.parse(localStorage.getItem('b8403-menu') || 'null'); } catch {}
  applyMenu({ ...roleMenu, assignments: !!(visible.materials && cached?.assignments), assignmentCodes: visible.materials ? cached?.assignmentCodes || [] : [] });
  let catalog = [], catalogError;
  if (visible.materials) {
    try { catalog = await state.backend.assignmentCatalog(state.access.term_id); } catch (error) { catalogError = error; }
    if (version !== state.version) return;
  }
  // Menu visibility only; every page still checks access on the server. The same flags are
  // remembered in this browser so the next page or tab can show the menu before sign-in is re-checked.
  const menu = { ...roleMenu, assignments: catalog.length > 0, assignmentCodes:catalog.map(i => i.code) };
  applyMenu(menu); await headerTerm(version);
  if(version !== state.version)return;
  try { if (state.access) localStorage.setItem('b8403-menu', JSON.stringify(menu)); else localStorage.removeItem('b8403-menu'); } catch {}
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
  if (root) {
    // Read the actual open state before detaching nodes. Their toggle events can arrive later.
    for(const detail of root.querySelectorAll('details.admin-section')) {
      if(detail.open)openSettings.add(detail.id);else openSettings.delete(detail.id);
    }
    root.onclick=null;root.replaceChildren();
  }
  try {
    if (root?.dataset.page === 'landing') {  // Course Materials lands on the current week; Home stays Home
      const sessions = await state.backend.sessions();
      if (version !== state.version) return;
      sessionStorage.removeItem('b8403-return');
      state.redirecting = true;
      location.replace(path(weekSlug(currentWeek(sessions))));
      return;
    } else if (root?.dataset.page === 'week') {
      const [data,canvas] = await Promise.all([state.backend.classData(),loadCanvas(state.backend,state.access,state.access.term_id)]);
      if (version !== state.version) return;
      root.replaceChildren();
      renderWeek({ root, data, canvas, access: state.access, backend: state.backend, refresh, path, fileLink });
      outlineChanged();
    } else if (root?.dataset.page === 'assignments') {
      if (catalogError) throw catalogError;
      const codes = root.dataset.assignmentCode === 'optional' ? ASSIGNMENT_CODES.filter(code => code.startsWith('O')) : [root.dataset.assignmentCode];
      const [data, pages, canvas] = await Promise.all([state.backend.classData(), state.backend.assignmentPages(state.access.term_id,codes),loadCanvas(state.backend,state.access,state.access.term_id)]);
      if (version !== state.version) return;
      root.replaceChildren();
      await renderAssignments({ root,data,canvas,access:state.access,backend:state.backend,refresh,path },catalog,pages);
      outlineChanged();
    } else if (root && ['preparation','speakers'].includes(root.dataset.page)) {
      const prep = root.dataset.page === 'preparation';
      const data = prep ? await state.backend.instructorNote(Number(root.dataset.week)) : await state.backend.speakers();
      if (version !== state.version) return;
      root.replaceChildren();
      if (prep) renderPreparationOutline({ root, note:data, backend:state.backend, confirmInline,
        outline:JSON.parse(document.querySelector('[data-preparation-outline]').textContent) });
      else renderSpeakers({ root, rows:data, backend:state.backend, confirmInline,
        weeks:JSON.parse(document.querySelector('[data-speaker-weeks]').textContent) });
      outlineChanged();
    } else if (root && [...CLASS_PAGES, ...INSTRUCTOR_PAGES].includes(root.dataset.page)) {
      const page = root.dataset.page;
      const chooseTerm = ['instructor','grader'].includes(state.access.role) && TERM_PAGES.includes(page);
      const term = chooseTerm ? state.selectedTerm || state.access.term_id : state.access.term_id;
      const terms = await state.backend.terms();
      const archived = terms.find(t=>t.id===term)?.status !== 'active';
      const attendanceCanvas=page==='attendance' && !archived ? await loadCanvas(state.backend,state.access,term) : null;
      const data = await state.backend.classData(term);
      if (version !== state.version) return;
      const pageAccess = { ...state.access, read_only: state.access.read_only || archived };
      root.replaceChildren();
      if (chooseTerm && document.body.classList.contains('standalone-tool')) {
        const label = el('label', 'Term', { class:'term-filter' }), select = el('select',null,{'aria-label':'Term'});
        for (const t of terms) select.append(el('option',`${t.title}${t.status==='active'?'':' · Read-only'}`,{value:t.id}));
        select.value=term; label.append(select); root.append(label);
        select.addEventListener('change',()=>{ state.selectedTerm=select.value; try { localStorage.setItem('b8403-term', select.value); } catch {} refresh(); });
      }
      if (chooseTerm && term !== state.access.term_id) root.append(el('p', 'Viewing an earlier term. Read-only.', { class: 'term-readonly-note' }));
      if (['grades','groups'].includes(page)) {
        const canvas=await loadCanvas(state.backend,pageAccess,term);
        if(version !== state.version)return;
        (page==='grades'?renderCanvasGrades:renderCanvasGroups)({root,data,canvas,access:pageAccess});
        if (archived) renderArchivedRecords({root,page,data});
      } else if (page === 'gradebook') await renderCanvasMode({root,backend:state.backend,term,active:!pageAccess.read_only,profiles:{data,access:pageAccess,backend:state.backend,refresh},
        renderLegacy:legacy=>renderClassPage({root:legacy,page,data,backend:state.backend,access:pageAccess,refresh,startPreview,currentRoot:()=>root.querySelector('[data-legacy-gradebook]')})});
      else if (CLASS_PAGES.includes(page) || page === 'gradebook') renderClassPage({ root, page, data, canvas:attendanceCanvas, backend: state.backend, access: pageAccess, refresh, startPreview });
      else {
        root.append(el('p', '', { class: 'materials-status', 'data-admin-status': '', role: 'status' }));
        if (page === 'roster') {
          const canvas=await state.backend.canvasData(term);if(version!==state.version)return;
          renderCanvasRoster({root,data:canvas,profiles:{data,access:pageAccess,backend:state.backend,refresh},startPreview});
          if (archived) {
            const archive=el('details');archive.append(el('summary','Archived site roster'));root.append(archive);
            renderRosterTable({root:archive,data,access:pageAccess,backend:state.backend,refresh,startPreview});
          }
        } else if (page === 'files') {
          const files = await state.backend.files(); if (version !== state.version) return; renderFileAdmin(files);
        } else if (page === 'settings') {
          await renderCanvasSettings({root:section('Canvas','canvas-settings'),backend:state.backend,term,items:data.items,readOnly:pageAccess.read_only});
          if (version !== state.version) return;
          if (!pageAccess.read_only) {
          const [admin, assignments, tests, announcements, overview] = await Promise.all([state.backend.adminData(), state.backend.assignments(), state.backend.testAccounts(), state.backend.announcements(), state.backend.staffOverview()]);
          if (version !== state.version) return;
          renderScheduleAdmin(data);
          renderFileAdmin(data.files);
          renderTermAdmin(overview);
          renderAnnouncementAdmin(announcements);
          renderAllowlist(admin.allowlist); renderAssignmentAdmin(assignments);
          const links = await state.backend.studentAccounts(); if(version !== state.version) return; renderStudentAccounts(links);
          const testSection = section('Test accounts', 'test-accounts');
          testSection.append(el('p', 'These accounts have fixed test access. This list is read-only.'));
          const list = el('ul'); for (const t of tests) list.append(el('li', `${t.email} · ${ROLE_LABELS[t.role]}${t.uni ? ` · ${t.uni}` : ''}`));
          testSection.append(list);
          groupSettings(overview);
          }
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
// Settings stays one list of collapsible rows; storage shows as a bar right after Files.
function groupSettings(overview) {
  const files = root.querySelector('#lecture-pdfs');
  if (!files || !overview) return;
  const used = overview.storage_bytes / 1024 / 1024, limit = (overview.storage_limit || 1073741824) / 1024 / 1024;
  const meter = el('div', null, { class: 'storage-meter', 'data-storage-usage': '' });
  const bar = el('div', null, { class: 'storage-bar' }); const fill = el('span'); fill.style.width = `${Math.min(100, used / limit * 100)}%`; bar.append(fill);
  meter.append(bar, el('span', `Storage: ${used.toFixed(1)} MB used / 1 GB`));
  files.after(meter);
}
function section(title, id) {
  const collapsible = root.dataset.page === 'settings';
  const s = el(collapsible ? 'details' : 'section', null, { class: 'admin-section', id });
  s.append(el(collapsible ? 'summary' : 'h2', title));
  if (collapsible) {
    s.open = openSettings.has(id);
    s.addEventListener('toggle', () => { if(!s.isConnected)return;if (s.open) openSettings.add(id); else openSettings.delete(id); });
  }
  root.append(s); return s;
}
function newForm(id) { return el('form', null, { class: 'admin-form', id }); }
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
}
function renderTermAdmin(overview) {
  const sectionNode=section('Term rollover', 'term-rollover');
  const active=overview.terms.find(t=>t.status==='active');
  sectionNode.append(el('p',`Active term: ${active?.title || 'None'}`));
  const form=newForm('open-term'),name=field(form,'New term name','name');name.required=true;name.maxLength=100;
  const approve=field(form,'Archive the current term and open the new term','confirm',false,'checkbox');approve.required=true;
  const open=button('Open term');open.type='submit';form.append(open);const status=formStatus(form);
  form.addEventListener('submit',e=>{e.preventDefault();if(approve.checked)runAction(open,status,async()=>{await state.backend.openTerm(name.value.trim());state.selectedTerm=null;try{localStorage.removeItem('b8403-term');}catch{}},'New term opened.',true);});
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
  try { localStorage.removeItem('b8403-menu'); } catch {}
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
