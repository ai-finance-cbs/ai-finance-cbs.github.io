import { classDate, nextSession, readingMinutes } from './upcoming-core.js';
import { groupOpen } from './class-core.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const block = (title, id) => {
  const section = el('section', null, { class: 'upcoming-block', id });
  section.append(el('h2', title));
  return section;
};

export function renderUpcoming({ root, data, access, path, fileLink }) {
  const next = nextSession(data.sessions);
  if (next) {
    const template = document.querySelector(`[data-upcoming-week="${next.week}"]`);
    root.append(el('p', [`Week ${next.week}`, template.dataset.weekTitle, classDate(next.date), next.time, next.room].filter(Boolean).join(' · '), { class: 'next-class', 'data-next-class': '' }));
    root.append(el('p', 'In-class quiz on the required readings (paper, no devices).', { class: 'tool-help' }));
    const columns = el('div', null, { class: 'upcoming-columns' });
    const reading = template.content.cloneNode(true);
    const times = [...reading.querySelectorAll('[data-reading-time]')];
    const total = times.reduce((sum, n) => sum + readingMinutes(n.textContent), 0);
    const complete = times.length === reading.querySelectorAll('li').length;
    reading.querySelector('[data-reading-total]').textContent = total ? `${complete ? 'Total' : 'Listed reading time'}: ${total} min` : 'Reading time not listed.';
    columns.append(reading);
    if (access.role !== 'auditor') {
      const milestone = block('Milestone', 'upcoming-milestone');
      const row = data.assignments.find(a => a.id === next.week);
      if (row) {
        milestone.append(el('h3', row.title), el('p', row.due, { class: 'upcoming-meta' }),
          el('p', row.description, { class: 'upcoming-excerpt' }),
          el('a', 'View assignment →', { href: `${path('assignments')}#${row.id === 6 ? 'final-prototype' : `milestone-${row.id}`}` }));
      } else milestone.append(el('p', 'This assignment has not been posted.'));
      columns.append(milestone);
    }
    const notes = block('Lecture Notes', 'upcoming-notes');
    let files = data.files.filter(f => f.week === next.week);
    if (!files.length) {
      notes.append(el('p', "This week's notes: posted after class", { class: 'upcoming-meta' }));
      files = data.files.filter(f => f.week === next.week - 1);
      if (files.length) notes.append(el('h3', `Week ${next.week - 1}`));
    }
    if (files.length) {
      const list = el('ul', null, { class: 'upcoming-files' });
      for (const file of files) {
        const li = el('li'); li.append(fileLink(file), el('span', ' · PDF', { class: 'upcoming-meta' })); list.append(li);
      }
      notes.append(list);
    }
    columns.append(notes); root.append(columns);
  } else root.append(el('p', 'All scheduled classes have finished.', { class: 'next-class', 'data-next-class': '' }));

  const announcements = block('Announcements', 'upcoming-announcements');
  if (!data.announcements.length) announcements.append(el('p', 'No announcements yet.', { class: 'upcoming-meta' }));
  for (const row of data.announcements) {
    const article = el('article', null, { class: 'announcement' });
    if (row.title) article.append(el('h3', row.title));
    article.append(el('time', new Date(row.created_at).toLocaleDateString('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
    }), { datetime: row.created_at, class: 'upcoming-meta' }), el('p', row.body, { class: 'announcement-body' }));
    announcements.append(article);
  }
  root.append(announcements);

  if (access.role === 'student') {
    const reminders = block('Groups', 'upcoming-groups');
    for (const set of data.groups.sets) {
      const own = data.groups.members.find(m => m.set_id === set.id && m.uni === access.uni);
      if (own) {
        const group = data.groups.groups.find(g => g.id === own.group_id);
        const teammates = data.groups.members.filter(m => m.group_id === own.group_id && m.uni !== access.uni).map(m => m.name).filter(Boolean);
        reminders.append(el('p', `${set.title} · Your group: ${group?.name || `Group ${group?.number}`}${teammates.length ? ` (${teammates.join(', ')})` : ''}`));
      } else if (groupOpen(set)) {
        const due = set.deadline ? ` by ${new Date(set.deadline).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` : '';
        const p = el('p'); p.append(el('a', `Sign up for ${set.title}${due} →`, { href: `${path('groups')}#set-${set.id}` })); reminders.append(p);
      }
    }
    if (reminders.children.length > 1) root.append(reminders);
  }
}
