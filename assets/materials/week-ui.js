import { canvasSubmissionBlock } from './canvas-student-ui.js';
import { courseTime, fileReleased, inClassFile } from './week-core.js';

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
    const dueReadings = document.querySelector('[data-week-due-readings]');
    if (dueReadings) due.append(dueReadings.content.cloneNode(true));
    if (access.role !== 'auditor') { due.append(el('h3', 'Milestone', { class: 'card-sub' })); due.append(canvasSubmissionBlock(ctx, week === 6 ? 'FP' : `M${week}`)); }
    // Total reading time comes from the listed lengths.
    const lengths = [...due.querySelectorAll('.due-reading-list [data-length]')].map(n => n.dataset.length);
    const minutes = lengths.reduce((sum, text) => sum + (Number(/(\d+)\s*hr/.exec(text)?.[1] || 0) * 60) + Number(/(\d+)\s*min/.exec(text)?.[1] || 0), 0);
    dueSummary.textContent = [lengths.length ? `${lengths.length} readings` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' · ');
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
