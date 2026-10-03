import { SUBMIT_CODES, submissionWeek } from './staff-core.js';
import { canWrite, gradeCode } from './class-core.js';
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
  const week = submissionWeek(code);
  const assignment = !code.startsWith('O') && data.assignments.find(a => a.id === week);
  const section = block(compact ? `${code} · ${assignment?.title || item?.title || code}` : 'Milestone', compact ? `submit-${code}` : week === 6 ? 'final-prototype' : `milestone-${week}`);
  section.dataset.submitCode = code;
  section.classList.add('assignment-section');
  if (compact) {
    section.classList.add('submit-item');
    const heading = section.querySelector('h2');
    if (week) { const link = el('a', heading.textContent, { href: `${path(`week-${week}`)}${week === 6 ? '#final-prototype' : `#milestone-${week}`}` }); heading.replaceChildren(link); }
  }
  if (!compact) section.append(el('h3', `${code} · ${assignment?.title || item?.title || 'Milestone'}`));
  if (item?.due_at) section.append(el('p', `Due ${courseTime(item.due_at)}`, { class: 'upcoming-meta' }));
  else section.append(el('p', compact ? '' : 'Due time to be announced.', { class: 'upcoming-meta' }));
  if (!compact) {
    if (assignment) {
      section.append(el('p', assignment.description, { class: 'assignment-copy' }));
      for (const [label, text] of [['Deliverable', assignment.deliverable], ['Graded on', assignment.grading]]) {
        if (text) { const p = el('p', null, { class: 'assignment-copy' }); p.append(el('strong', `${label}: `), document.createTextNode(text)); section.append(p); }
      }
    } else section.append(el('p', 'Instructions have not been posted.'));
  }
  if (!item) return section;
  const group = ownGroup(data, item, access.uni);
  if (!compact) {
    const own = ownSubmission(data, item, access.uni);
    const state = item.locked || own?.locked ? ['Graded', 'graded'] : own?.late ? ['Late', 'late'] : own ? ['Submitted', 'done']
      : item.mode === 'group' && !group && access.role === 'student' ? ['Join a group', 'todo'] : ['Incomplete', 'todo'];
    section.querySelector('h3')?.append(el('span', state[0], { class: `ms-chip ms-${state[1]}`, 'data-milestone-state': state[1] }));
  }
  section.append(el('p', item.mode === 'individual' ? 'Individual' : compact ? (group ? `Group ${group.number}` : 'Group') : `Group submission${group ? `: Group ${group.number}` : ''}`, { class: 'submission-mode' }));
  const submission = ownSubmission(data, item, access.uni);
  const status = el('p', '', { class: 'submission-status', role: 'status', 'data-submission-status': '' });
  const stateLine = el('div', null, { class:'submission-state' }); stateLine.append(status);
  const showStatus = () => {
    status.replaceChildren(document.createTextNode(submissionStatus(submission)));
    if (submission) {
      status.append(document.createTextNode(` · ${submission.file_name || submission.link}${compact ? '' : ` · ${courseTime(submission.submitted_at)}`}`));
      if (submission.link) status.append(document.createTextNode(' · '), el('a', 'Open submission', { href: submission.link, target: '_blank', rel: 'noopener noreferrer' }));
    }
  };
  showStatus();
  status.title = status.textContent;
  if (compact) section.append(stateLine);
  if (item.locked || submission?.locked) {
    if (compact) { status.textContent = 'Graded, locked.'; return section; }
    const locked = el('div', null, { class: 'submission-box', 'data-submission-locked': '' });
    locked.append(el('p', 'Graded, locked.'), status); section.append(locked); return section;
  }
  if (item.mode === 'group' && !group && access.role === 'student') {
    if (compact) status.replaceChildren(el('a', 'Join a group first', { href: path('groups') }));
    else section.append(el('p', 'Join a group first.'), el('a', 'Go to Groups', { href: path('groups') }), status);
    return section;
  }
  if (item.kind === 'none') return section;
  const form = el('form', null, { class: 'submission-box' });
  const row = el('div', null, { class: 'submission-row' });
  const input = el('input', null, { id: `submission-${item.id}`, type: item.kind === 'link' ? 'url' : 'file', 'aria-label': item.kind === 'link' ? 'Prototype HTTPS link' : 'Submission file' });
  const save = el('button', submission ? 'Replace submission' : 'Submit', { type: 'submit', class: 'materials-button' });
  const progress = el('div', null, { class:'submission-progress', 'data-upload-progress':'' }); progress.hidden = true;
  const meter = el('progress', null, { max:'100', value:'0', 'aria-label':'File upload progress' });
  const progressText = el('span', '', { 'data-upload-percent':'' }); progress.append(meter, progressText);
  let choose, remove;
  if (item.kind === 'file') {
    input.accept = '.pdf,.docx,.xlsx,.pptx,.zip'; input.hidden = true;
    choose = el('button', 'Choose file', { type: 'button', class: 'materials-button' });
    choose.addEventListener('click', () => input.click());
    const filename = el('span', 'No file selected', { class: 'selected-file-name', 'data-selected-file': '' });
    input.addEventListener('change', () => { filename.textContent = input.files[0]?.name || 'No file selected'; if (compact) { status.textContent = filename.textContent; status.title = filename.textContent; } });
    row.append(choose);
    if (!compact) { const selected = el('div', null, { class:'selected-file' }); selected.append(filename, progress); row.append(selected); }
    else stateLine.append(progress);
    row.append(input);
  } else {
    input.placeholder = 'https://';
    row.append(input);
  }
  row.append(save);
  const writable = access.role === 'student' && canWrite(access);
  const disable = value => { for (const control of [input, choose, save, remove]) if (control) control.disabled = value; };
  disable(!writable);
  form.noValidate = true;
  const hint = el('p', item.kind === 'file' ? 'PDF, DOCX, XLSX, PPTX, or ZIP · up to 25 MB' : 'Use an HTTPS video link.', { class: 'submission-hint', id: `submission-hint-${item.id}` });
  input.setAttribute('aria-describedby', compact ? 'submit-format-hint' : hint.id);
  if (compact) form.append(row); else form.append(row, stateLine, hint);
  let saving = false;
  if (submission && writable && (!submission.group_id || submission.is_uploader) && (!item.due_at || Date.now() < new Date(item.due_at).getTime())) {
    const actions = el('span', null, { class:'submission-delete' });
    remove = el('button', 'Delete submission', { type:'button', class:'text-action' });
    remove.addEventListener('click', () => {
      if (saving) return;
      saving = true; disable(true);
      const prompt = el('span', `Delete ${submission.file_name || submission.link}?`, { class:'inline-confirm', 'data-delete-confirm':'' });
      const confirm = el('button', 'Delete', { type:'button', class:'materials-button' });
      const cancel = el('button', 'Cancel', { type:'button', class:'materials-button' });
      const finish = () => { prompt.remove(); saving = false; disable(!writable); };
      cancel.addEventListener('click', finish);
      confirm.addEventListener('click', async () => {
        confirm.disabled = true; cancel.disabled = true; status.textContent = 'Deleting…';
        try { await backend.deleteSubmission(submission.id); await refresh(); }
        catch (error) { status.textContent = error.message; }
        finally { finish(); }
      });
      prompt.append(confirm, cancel); actions.append(prompt); cancel.focus();
    });
    actions.append(remove); stateLine.append(actions);
  }
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
        if (compact) { status.textContent = input.files[0].name; status.title = input.files[0].name; }
        await backend.submitFile(item.id, input.files[0], percent => {
          progress.hidden = false; meter.value = percent;
          progressText.textContent = `Uploading ${percent}%`;
        });
      }
      await refresh();
    } catch (error) {
      progress.hidden = true;
      status.textContent = error.message;
      // Another member or grader may have changed the owner while this page was open.
      if (/graded.*locked/i.test(error.message)) {
        disable(true);
        status.setAttribute('data-submission-locked', '');
        return;
      }
    } finally {
      progress.hidden = true;
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
    // Card 1: everything due before class (quiz readings + milestone)
    const due = block('Due before class', 'due-before-class');
    const dueSummary = el('span', '', { class: 'card-summary' }); due.querySelector('h2').after(dueSummary);
    due.append(el('p', 'There will be a 3-question quiz on these readings at the start of class.', { class: 'due-note' }));
    const dueReadings = document.querySelector('[data-week-due-readings]');
    if (dueReadings) due.append(dueReadings.content.cloneNode(true));
    if (access.role !== 'auditor') { due.append(el('h3', 'Milestone', { class: 'card-sub' })); due.append(submissionBlock(ctx, week === 6 ? 'FP' : `M${week}`)); }
    // "8 readings · 72 min · M3": total reading time parsed from the listed lengths
    const lengths = [...due.querySelectorAll('.due-reading-list [data-length]')].map(n => n.dataset.length);
    const minutes = lengths.reduce((sum, text) => sum + (Number(/(\d+)\s*hr/.exec(text)?.[1] || 0) * 60) + Number(/(\d+)\s*min/.exec(text)?.[1] || 0), 0);
    dueSummary.textContent = [lengths.length ? `${lengths.length} readings` : '', minutes ? `${minutes} min` : '', access.role !== 'auditor' ? (week === 6 ? 'FP' : `M${week}`) : ''].filter(Boolean).join(' · ');
    root.append(due);
  }
  // Card 2: lecture notes and in-class materials together
  const materials = block('Lecture notes & materials', 'lecture-notes');
  const weekFiles = data.files.filter(f => f.week === week);
  if (!weekFiles.length) materials.append(el('p', 'Posted after class.', { class: 'upcoming-meta' }));
  for (const isClass of [true, false]) {
    const files = weekFiles.filter(f => inClassFile(f) === isClass);
    const section = el('div', null, { id: isClass ? 'in-class-files' : 'lecture-note-files', class: 'week-file-group' });
    if (files.length) section.append(el('h3', isClass ? 'In class' : 'Notes', { class: 'week-file-label' }));
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
    section.append(list); materials.append(section);
  }
  root.append(materials);
  // Card 3: the full reading list with levels
  const readings = document.querySelector('[data-week-readings]');
  if (readings) root.append(readings.content.cloneNode(true));
}

export function renderSubmit(ctx) {
  ctx.root.append(el('p', 'PDF, DOCX, XLSX, PPTX, or ZIP · up to 25 MB. FP: HTTPS video link.', { id:'submit-format-hint', class:'submission-hint' }));
  for (const code of SUBMIT_CODES) {
    if (ctx.data.submission_items.some(i => gradeCode(i) === code && ['file','link'].includes(i.kind))) ctx.root.append(submissionBlock(ctx, code, true));
  }
}
