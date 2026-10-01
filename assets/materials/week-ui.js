import { SUBMIT_CODES, submissionWeek } from './staff-core.js';
import { canWrite, gradeCode } from './class-core.js';
import { classDate } from './upcoming-core.js';
import { courseTime, ownGroup, ownSubmission, submissionStatus, fileReleased, inClassFile } from './week-core.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const block = (title, id) => {
  const section = el('section', null, { class: 'week-block', id });
  section.append(el('h2', title));
  return section;
};
function submissionBlock({ data, access, path, backend, refresh }, code, compact = false) {
  const item = data.submission_items.find(i => gradeCode(i) === code);
  const week = submissionWeek(code, item, data.sessions);
  const assignment = !code.startsWith('O') && data.assignments.find(a => a.id === week);
  const section = block(compact ? `${code} · ${assignment?.title || item?.title || code}` : 'Milestone', compact ? `submit-${code}` : week === 6 ? 'final-prototype' : `milestone-${week}`);
  section.dataset.submitCode = code;
  section.classList.add('assignment-section');
  if (!compact) section.append(el('h3', `${code} · ${assignment?.title || item?.title || 'Milestone'}`));
  if (item?.due_at) section.append(el('p', `Due ${courseTime(item.due_at)}`, { class: 'upcoming-meta' }));
  else section.append(el('p', 'Due time to be announced.', { class: 'upcoming-meta' }));
  if (compact) section.append(el('a', `Week ${week}`, { href: `${path(`week-${week}`)}${code.startsWith('O') ? '' : week === 6 ? '#final-prototype' : `#milestone-${week}`}` }));
  else if (assignment) {
    section.append(el('p', assignment.description, { class: 'assignment-copy' }));
    for (const [label, text] of [['Deliverable', assignment.deliverable], ['Graded on', assignment.grading]]) {
      if (text) { const p = el('p', null, { class: 'assignment-copy' }); p.append(el('strong', `${label}: `), document.createTextNode(text)); section.append(p); }
    }
  } else section.append(el('p', 'Instructions have not been posted.'));
  if (!item) return section;
  const group = ownGroup(data, item, access.uni);
  section.append(el('p', item.mode === 'individual' ? 'Individual' : `Group submission${group ? `: Group ${group.number}` : ''}`, { class: 'submission-mode' }));
  const submission = ownSubmission(data, item, access.uni);
  const status = el('p', '', { class: 'submission-status', role: 'status', 'data-submission-status': '' });
  const showStatus = () => {
    status.replaceChildren(document.createTextNode(submissionStatus(submission)));
    if (submission) {
      status.append(document.createTextNode(` · ${submission.file_name || submission.link} · ${courseTime(submission.submitted_at)}`));
      if (submission.link) status.append(document.createTextNode(' · '), el('a', 'Open submission', { href: submission.link, target: '_blank', rel: 'noopener noreferrer' }));
    }
  };
  showStatus();
  if (item.locked || submission?.locked) {
    const locked = el('div', null, { class: 'submission-box', 'data-submission-locked': '' });
    locked.append(el('p', 'Graded, locked.'), status); section.append(locked); return section;
  }
  if (item.mode === 'group' && !group && access.role === 'student') {
    section.append(el('p', 'Join a group first.'), el('a', 'Go to Groups', { href: path('groups') }), status); return section;
  }
  if (item.kind === 'none') return section;
  const form = el('form', null, { class: 'submission-box' });
  const row = el('div', null, { class: 'submission-row' });
  const input = el('input', null, { id: `submission-${item.id}`, type: item.kind === 'link' ? 'url' : 'file', 'aria-label': item.kind === 'link' ? 'Prototype HTTPS link' : 'Submission file' });
  const save = el('button', submission ? 'Replace submission' : 'Submit', { type: 'submit', class: 'materials-button' });
  let choose;
  if (item.kind === 'file') {
    input.accept = '.pdf,.docx,.xlsx,.pptx,.zip'; input.hidden = true;
    choose = el('button', 'Choose file', { type: 'button', class: 'materials-button' });
    choose.addEventListener('click', () => input.click());
    const filename = el('span', 'No file selected', { class: 'selected-file-name', 'data-selected-file': '' });
    input.addEventListener('change', () => { filename.textContent = input.files[0]?.name || 'No file selected'; });
    row.append(choose, filename, input);
  } else {
    input.placeholder = 'https://';
    row.append(input);
  }
  row.append(save);
  const writable = access.role === 'student' && canWrite(access);
  const disable = value => { for (const control of [input, choose, save]) if (control) control.disabled = value; };
  disable(!writable);
  form.noValidate = true;
  const hint = el('p', item.kind === 'file' ? 'PDF, DOCX, XLSX, PPTX, or ZIP · up to 25 MB' : 'Use an HTTPS video link.', { class: 'submission-hint', id: `submission-hint-${item.id}` });
  input.setAttribute('aria-describedby', hint.id);
  form.append(row, status, hint);
  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!writable || saving) return;
    saving = true; disable(true); status.textContent = 'Submitting…';
    try {
      if (item.kind === 'link') {
        const link = input.value.trim();
        if (!/^https:\/\//i.test(link)) throw new Error('Link must start with https://.');
        await backend.submitLink(item.id, link);
      } else {
        if (!input.files[0]) throw new Error('Choose a file to submit.');
        await backend.submitFile(item.id, input.files[0]);
      }
      await refresh();
    } catch (error) {
      status.textContent = error.message;
      // Another member or grader may have changed the owner while this page was open.
      if (/graded.*locked/i.test(error.message)) {
        disable(true);
        status.setAttribute('data-submission-locked', '');
        return;
      }
    } finally {
      saving = false;
      if (!status.hasAttribute('data-submission-locked')) disable(!writable);
    }
  });
  section.append(form); return section;
}
export function renderWeek(ctx) {
  const { root, data, access, backend, refresh, fileLink } = ctx;
  const week = Number(root.dataset.week);
  if (week >= 1 && week <= 6) {
    const notices = [...data.announcements].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    if (notices.length) {
      const announcements = block('Announcements', 'week-announcements');
      const notice = row => {
        const article = el('article', null, { class: 'announcement' });
        if (row.title) article.append(el('h3', row.title));
        article.append(el('time', courseTime(row.created_at), { datetime: row.created_at, class: 'upcoming-meta' }), el('p', row.body, { class: 'announcement-body' }));
        return article;
      };
      announcements.append(notice(notices[0]));
      if (notices.length > 1) {
        const earlier = el('details', null, { class: 'earlier-notices' });
        earlier.append(el('summary', `Earlier notices (${notices.length - 1})`));
        for (const row of notices.slice(1)) earlier.append(notice(row));
        announcements.append(earlier);
      }
      root.append(announcements);
    }
    const session = data.sessions.find(s => s.week === week);
    const when = session?.starts_at ? courseTime(session.starts_at) : classDate(session?.date);
    root.append(el('p', `Next class · Week ${week}${when ? ` · ${when}` : ' · Date to be announced'}${session?.room ? ` · ${session.room}` : ''}; the paper quiz covers this week’s readings.`, { class: 'next-class', 'data-next-class': '' }));
    if (access.role !== 'auditor') root.append(submissionBlock(ctx, week === 6 ? 'FP' : `M${week}`));
  }
  for (const isClass of [true, false]) {
    const section = block(isClass ? 'In-class files' : 'Lecture notes', isClass ? 'in-class-files' : 'lecture-notes');
    const files = data.files.filter(f => f.week === week && inClassFile(f) === isClass);
    if (!files.length) section.append(el('p', isClass ? 'No files released yet.' : 'Posted after class.', { class: 'upcoming-meta' }));
    const list = el('ul', null, { class: 'week-files' });
    for (const file of files) {
      const li = el('li'); li.append(fileLink(file));
      if (isClass && access.role === 'instructor' && !access.view_as && !fileReleased(file)) {
        const release = el('button', 'Release now', { type: 'button', class: 'text-action' });
        const status = el('span', '', { role: 'status' });
        release.addEventListener('click', async () => {
          release.disabled = true;
          try { await backend.setFileRelease(file.id, true); await refresh(); }
          catch (error) { status.textContent = error.message; release.disabled = false; }
        });
        li.append(release, status);
      }
      list.append(li);
    }
    section.append(list); root.append(section);
  }
  const readings = document.querySelector('[data-week-readings]');
  if (readings) root.append(readings.content.cloneNode(true));
}

export function renderSubmit(ctx) {
  for (const code of SUBMIT_CODES) {
    if (ctx.data.submission_items.some(i => gradeCode(i) === code && ['file','link'].includes(i.kind))) ctx.root.append(submissionBlock(ctx, code, true));
  }
}
