import { studentGradeRows, submissionStatus } from './week-core.js';
import {
  canWrite,
  gradeTotal,
  gradeCode,
  groupOpen,
  parsePresentCsv,
  parseGradesCsv,
  scoreValue,
  toCsv,
} from './class-core.js';
let selectedGradeItem = 'all';
const studentQueries = new Map();
const el = (tag, text, attrs = {}) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const button = (text, action) => {
  const b = el('button', text, { type: 'button', class: 'materials-button' });
  b.addEventListener('click', action);
  return b;
};
const options = (values, value, label) => {
  const s = el('select', null, { 'aria-label': label });
  values.forEach(([v, t]) => s.append(el('option', t, { value: v })));
  s.value = value ?? '';
  return s;
};
function input(type, label, value = '') {
  const n = el('input', null, { type, 'aria-label': label });
  n.value = value;
  return n;
}
export function wrapTable(table) {
  const w = el('div', null, {
    class: 'class-grid-wrap',
    tabindex: '0',
    'aria-label': 'Scrollable class table',
  });
  w.append(table);
  return w;
}
export function table(headers) {
  const t = el('table', null, { class: 'class-grid' }),
    head = el('tr'),
    body = el('tbody');
  headers.forEach((h) => head.append(el('th', h, { scope: 'col' })));
  const thead = el('thead');
  thead.append(head);
  t.append(thead, body);
  return { t, body, head };
}
function studentCell(student) {
  const cell = el('th', null, { scope: 'row', title: `${student.name || student.uni} (${student.uni})` });
  const identity = el('span', null, { class: 'student-identity' });
  identity.append(el('span', student.name || student.uni, { class: 'student-name' }), el('span', student.uni, { class: 'student-uni' }));
  cell.append(identity);
  return cell;
}
function studentRow(student) {
  return el('tr', null, { 'data-student': `${student.name || ''} ${student.uni}`.toLowerCase() });
}
function studentFilter(t, key) {
  const bar = el('div', null, { class: 'table-tools' });
  const search = input('search', 'Filter by name or UNI', studentQueries.get(key) || '');
  search.placeholder = 'Filter by name or UNI';
  const count = el('span', '', { class: 'student-count', role: 'status' });
  const empty = el('tr', null, { class: 'empty-filter' });
  empty.append(el('td', 'No matching students.', { colspan: t.tHead.rows[0].cells.length }));
  t.tBodies[0].append(empty);
  const apply = () => {
    const rows = [...t.querySelectorAll('[data-student]')];
    const query = search.value.trim().toLowerCase();
    rows.forEach(row => row.hidden = !row.dataset.student.includes(query));
    const shown = rows.filter(row => !row.hidden).length;
    count.textContent = `${shown}${query ? ` of ${rows.length}` : ''} students`;
    empty.hidden = shown > 0;
    studentQueries.set(key, search.value);
  };
  search.addEventListener('input', apply);
  bar.append(search, count);
  apply();
  return bar;
}
function disclosure(title, id) {
  const details = el('details', null, { class: 'tool-disclosure', id });
  details.append(el('summary', title));
  return details;
}
function download(name, rows) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', null, { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function labeled(parent, label, node) {
  const l = el('label', label, { class: 'tool-label' });
  l.append(node);
  parent.append(l);
  return node;
}
function statusNote(a) {
  if (!a) return 'Not recorded';
  if (a.source_quiz)
    return a.manual_override
      ? `Manual override; Quiz ${a.source_quiz} recorded`
      : `from Quiz ${a.source_quiz}`;
  return a.manual_override == null ? '' : 'Manual entry';
}
export function renderRosterTable(ctx) {
  const { root, data, startPreview } = ctx;
  const { t, body } = table(['Student', 'Groups', 'Present', 'Preview']);
  for (const r of data.roster) {
    const tr = studentRow(r),
      memberships = data.members.filter((m) => m.uni === r.uni);
    const names = memberships.map(
      (m) =>
        `${data.sets.find((s) => s.id === m.set_id)?.title}: Group ${data.groups.find((g) => g.id === m.group_id)?.number}`,
    );
    const last = el('td');
    const preview = button('View as', () => startPreview(r.uni));
    preview.setAttribute('aria-label', `View as ${r.name || r.uni}`);
    last.append(preview);
    tr.append(
      studentCell(r),
      el('td', names.join('; ') || 'No group'),
      el(
        'td',
        `${data.attendance.filter((a) => a.uni === r.uni && a.status === 'present').length} / 6`,
      ),
      last,
    );
    body.append(tr);
  }
  root.append(studentFilter(t, 'roster'), wrapTable(t));
}
export function renderClassPage(ctx) {
  const { root, page, data, backend, access, refresh } = ctx;
  const admin = access.role === 'instructor' && !access.view_as;
  const grading = ['instructor', 'grader'].includes(access.role) && !access.view_as;
  const status = el('p', '', {
    class: 'materials-status',
    role: 'status',
    'data-admin-status': '',
  });
  root.append(status);
  let saving = false;
  const run = async (task, text, rerender = true) => {
    if (saving) return false;
    saving = true;
    status.textContent = 'Saving…';
    const focusLabel = document.activeElement?.getAttribute('aria-label');
    const positions = [...root.querySelectorAll('.class-grid-wrap')].map(w => [w.scrollLeft, w.scrollTop]);
    try {
      await task();
      if (rerender) {
        await refresh();
        root.querySelector('[data-admin-status]')?.append(document.createTextNode(text));
        [...root.querySelectorAll('.class-grid-wrap')].forEach((w, i) => {
          if (positions[i]) [w.scrollLeft, w.scrollTop] = positions[i];
        });
        if (focusLabel) [...root.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
      } else status.textContent = text;
      return true;
    } catch (e) {
      status.textContent = e.message;
      return false;
    } finally {
      saving = false;
    }
  };
  const section = (title, id) => {
    const s = el('section', null, { class: 'admin-section', id });
    s.append(el('h2', title));
    root.append(s);
    return s;
  };
  if (page === 'attendance') {
    root.append(
      el(
        'p',
        grading
          ? 'Quiz scores mark attendance present. Manual changes override the quiz result.'
          : 'Your attendance and released grades appear here.',
        { class: 'tool-help' },
      ),
    );
    if (grading) {
      const { t, body, head } = table(['Student', ...data.sessions.map((s) => `Week ${s.week}`)]);
      const classUnis = new Set(data.roster.map(r => r.uni));
      t.classList.add('attendance-grid');
      data.sessions.forEach((s, i) => {
        const cell = head.children[i + 1],
          date = input('date', `Week ${s.week} date`, s.date || '');
        date.addEventListener('change', async () => {
          if (await run(
            () => backend.setSessionDate(s.week, date.value || null),
            'Session date saved.',
            false,
          )) s.date = date.value || null;
          else date.value = s.date || '';
        });
        if (admin) cell.append(date);
        else cell.append(el('span', s.date || 'Date TBA', { class: 'session-date' }));
        const markAll = button('Mark all present', () => {
            if (confirm(`Mark all ${data.roster.length} students present for Week ${s.week}?`))
              run(
                () =>
                  backend.saveAttendance(
                    s.week,
                    data.roster.map((r) => ({ uni: r.uni, status: 'present' })),
                  ),
                'Attendance saved.',
              );
          });
        markAll.setAttribute('aria-label', `Mark all present: Week ${s.week}`);
        cell.append(markAll);
      });
      const totals = el('tr', null, { class: 'attendance-totals' });
      totals.append(el('th', 'Class totals', { scope: 'row' }));
      for (const s of data.sessions) {
        const cell = el('td', null, { 'aria-label': `Week ${s.week} totals` });
        for (const [value, label] of [['present', 'P'], ['absent', 'A'], ['excused', 'E']]) {
          const count = data.attendance.filter(a => classUnis.has(a.uni) && a.week === s.week && a.status === value).length;
          cell.append(el('span', `${count}${label}`, { class: `total-${value}`, title: `${count} ${value}` }));
        }
        totals.append(cell);
      }
      body.append(totals);
      for (const r of data.roster) {
        const tr = studentRow(r);
        tr.append(studentCell(r));
        for (const s of data.sessions) {
          const a = data.attendance.find((a) => a.uni === r.uni && a.week === s.week),
            td = el('td');
          const select = options(
            [
              ['', 'Quiz / clear'],
              ['present', 'Present'],
              ['absent', 'Absent'],
              ['excused', 'Excused'],
            ],
            a?.status || '',
            `${r.uni} Week ${s.week} attendance`,
          );
          select.title = 'Use quiz or clear removes the manual override.';
          select.addEventListener('change', async () => {
            select.disabled = true;
            if (!await run(
              () => backend.saveAttendance(s.week, [{ uni: r.uni, status: select.value || null }]),
              'Attendance saved.',
            )) select.value = a?.status || '';
            select.disabled = false;
          });
          td.append(select);
          if (a?.source_quiz) {
            const source = el('span', `Q${a.source_quiz}${a.manual_override ? '*' : ''}`, { class: 'quiz-marker', title: statusNote(a) });
            source.append(el('span', ` ${statusNote(a)}`, { class: 'sr-only' }));
            td.append(source);
          }
          tr.append(td);
        }
        body.append(tr);
      }
      root.append(studentFilter(t, 'attendance'), wrapTable(t));
      const s = disclosure('Import attendance CSV', 'attendance-import'),
        form = el('form', null, { class: 'admin-form' }),
        week = options(
          data.sessions.map((s) => [s.week, `Week ${s.week}`]),
          1,
          'Attendance import week',
        ),
        file = input('file', 'Present UNI CSV');
      file.accept = '.csv';
      file.required = true;
      labeled(form, 'Session', week);
      labeled(form, 'CSV of present UNIs', file);
      form.append(
        el('p', 'Use a UNI column or one UNI per line. Other attendance records stay unchanged.'),
      );
      const submit = button('Import present UNIs', () => {});
      submit.type = 'submit';
      form.append(submit);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await run(async () => {
          const rows = parsePresentCsv(await file.files[0].text(), data.roster);
          await backend.saveAttendance(Number(week.value), rows);
        }, 'Present UNIs imported.');
      });
      s.append(form);
      root.append(s);
    } else {
      const { t, body } = table(['Session', 'Date', 'Status', 'Source']);
      t.classList.add('student-attendance-grid');
      for (const s of data.sessions.filter(s => s.week >= 1 && s.week <= 6).sort((a,b) => a.week - b.week)) {
        const a = data.attendance.find((a) => a.week === s.week),
          tr = el('tr');
        tr.append(
          el('th', `Week ${s.week}`, { scope: 'row' }),
          el('td', s.date || 'Date TBA'),
          el('td', a?.status || 'Not recorded'),
          el('td', a ? statusNote(a) : ''),
        );
        body.append(tr);
      }
      root.append(wrapTable(t));
    }
  }
  if (page === 'grades') {
    const list = el('div', null, { id: 'my-grades', class: 'student-grades' });
    for (const item of studentGradeRows(data)) {
      const row = el('section', null, { class: 'student-grade', 'data-grade-code': item.code });
      row.append(el('h2', `${item.code} · ${item.title}`));
      const hasScore = item.grade?.score != null;
      if (!hasScore && ['file', 'link'].includes(item.kind))
        row.append(el('p', submissionStatus(item.submission), { class: 'grade-status' }));
      if (hasScore) {
        row.append(el('p', `${item.grade.score} / ${item.max_points}`, { class: 'grade-score' }));
        if (item.grade?.comment) row.append(el('p', item.grade.comment, { class: 'grade-comment' }));
      }
      list.append(row);
    }
    const released = data.items.filter(i => i.released);
    root.append(el('p', `Released points: ${gradeTotal(released, data.grades).total}. Optional points are capped at 15; course totals at 100.`, { class: 'tool-help' }), list);
  }
  if (page === 'groups') {
    if (admin) {
      const s = section('Create a group set', 'create-group-set'),
        form = el('form', null, { class: 'admin-form' }),
        title = input('text', 'Group set title'),
        count = input('number', 'Number of groups', 2),
        max = input('number', 'Maximum group size', 4),
        deadline = input('datetime-local', 'Sign-up deadline');
      title.required = true;
      title.maxLength = 200;
      for (const n of [count, max]) {
        n.min = 1;
        n.max = 100;
        n.required = true;
      }
      labeled(form, 'Group set title', title);
      labeled(form, 'Number of groups', count);
      labeled(form, 'Maximum group size', max);
      labeled(form, 'Optional deadline (your local time)', deadline);
      const submit = button('Create group set', () => {});
      submit.type = 'submit';
      form.append(submit);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        run(
          () =>
            backend.createSet({
              title: title.value.trim(),
              count: Number(count.value),
              max_size: Number(max.value),
              deadline: deadline.value ? new Date(deadline.value).toISOString() : null,
            }),
          'Group set created.',
        );
      });
      s.append(form);
      root.append(
        button('Export groups CSV', () =>
          download('groups.csv', [
            ['Set', 'Group', 'UNI', 'Name', 'Email'],
            ...data.members.map((m) => [
              data.sets.find((s) => s.id === m.set_id)?.title,
              data.groups.find((g) => g.id === m.group_id)?.number,
              m.uni,
              m.name,
              m.email,
            ]),
          ]),
        ),
      );
    }
    if (!data.sets.length) root.append(el('p', 'No group sets have been posted yet.'));
    for (const set of data.sets) {
      const s = section(set.title, `set-${set.id}`),
        open = groupOpen(set),
        own = data.members.find((m) => m.set_id === set.id && m.uni === access.uni);
      s.append(
        el(
          'p',
          `${open ? 'Open for sign-up' : 'Sign-up closed'} · Maximum ${set.max_size} per group${set.deadline ? ` · Deadline ${new Date(set.deadline).toLocaleString()}` : ''}`,
        ),
      );
      if (admin) {
        const deadline = input(
          'datetime-local',
          `${set.title} deadline`,
          set.deadline
            ? new Date(
                new Date(set.deadline).getTime() -
                  new Date(set.deadline).getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)
            : '',
        );
        s.append(
          button(set.is_open ? `Lock ${set.title}` : `Open ${set.title}`, () =>
            run(() => backend.updateSet(set.id, !set.is_open, set.deadline), 'Group set updated.'),
          ),
        );
        labeled(s, 'Deadline (your local time)', deadline);
        s.append(
          button(`Save deadline for ${set.title}`, () =>
            run(
              () =>
                backend.updateSet(
                  set.id,
                  set.is_open,
                  deadline.value ? new Date(deadline.value).toISOString() : null,
                ),
              'Deadline saved.',
            ),
          ),
        );
        const form = el('form', null, { class: 'admin-form inline-tools' }),
          student = options(
            data.roster.map((r) => [r.uni, `${r.name || r.uni} (${r.uni})`]),
            data.roster[0]?.uni,
            `${set.title} student`,
          ),
          group = options(
            [
              ['', 'Remove from this set'],
              ...data.groups
                .filter((g) => g.set_id === set.id)
                .map((g) => [g.id, `Group ${g.number}`]),
            ],
            '',
            `${set.title} destination`,
          );
        labeled(form, 'Student', student);
        labeled(form, 'Destination', group);
        const move = button(`Move student in ${set.title}`, () => {});
        move.type = 'submit';
        form.append(move);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          run(
            () => backend.chooseGroup(set.id, group.value || null, student.value),
            'Group membership updated.',
          );
        });
        s.append(form);
      }
      const { t, body } = table(['Group', 'Seats left', 'Members', ...(!admin && canWrite(access) && open ? ['Action'] : [])]);
      t.classList.add('group-grid');
      for (const g of data.groups.filter((g) => g.set_id === set.id)) {
        const row = el('tr'), memberCell = el('td'), actions = el('td'),
          members = data.members.filter((m) => m.group_id === g.id);
        row.append(
          el('th', `Group ${g.number}${own?.group_id === g.id ? ' · Yours' : ''}`, { scope: 'row' }),
          el('td', `${set.max_size - members.length} / ${set.max_size}`),
        );
        const names = el('ul');
        for (const m of members.filter((m) => m.name)) {
          const li = el('li', m.name);
          if (m.email)
            li.append(
              document.createTextNode(' · '),
              el('a', m.email, { href: `mailto:${m.email}` }),
            );
          names.append(li);
        }
        memberCell.append(names);
        if (members.length && !members.some((m) => m.name))
          memberCell.append(el('span', 'Join to see teammates.'));
        if (!members.length) memberCell.append(el('span', 'No members yet.'));
        row.append(memberCell);
        if (!admin && canWrite(access) && open) {
          if (own?.group_id === g.id)
            actions.append(
              button(`Leave Group ${g.number} in ${set.title}`, () =>
                run(() => backend.chooseGroup(set.id, null), 'You left the group.'),
              ),
            );
          else {
            const b = button(
              `${own ? 'Switch to' : 'Join'} Group ${g.number} in ${set.title}`,
              () => run(() => backend.chooseGroup(set.id, g.id), 'Group membership saved.'),
            );
            b.disabled = members.length >= set.max_size;
            actions.append(b);
          }
          const action = actions.firstElementChild;
          action.setAttribute('aria-label', action.textContent);
          action.textContent = own?.group_id === g.id ? 'Leave' : own ? 'Switch' : 'Join';
          row.append(actions);
        }
        body.append(row);
      }
      s.append(wrapTable(t));
    }
  }
  if (page === 'gradebook') {
    root.append(
      el(
        'p',
        'Quiz scores mark attendance. Enter / ↓ moves down; Tab moves across. Blank scores are ungraded.',
        { class: 'tool-help' },
      ),
    );
    const legend = disclosure('Legend', 'grade-legend');
    const legendList = el('ul');
    for (const item of data.items) {
      const note = item.optional ? ' · Optional tasks are capped at 15 points total.' : item.quiz_week ? ' · A quiz score marks attendance present.' : '';
      legendList.append(el('li', `${gradeCode(item)} → ${item.title} → ${item.max_points} points${note}`));
    }
    legend.append(legendList);
    root.append(legend);
    const filter = options(
      [['all', 'All grading items'], ...data.items.map((i) => [i.id, gradeCode(i)])],
      selectedGradeItem,
      'Gradebook item',
    );
    filter.title = 'Jump to one grading item or show all columns.';
    const content = el('div');
    const changes = new Map();
    root.append(content);
    function draw() {
      changes.clear();
      content.replaceChildren();
      const items =
          filter.value === 'all'
            ? data.items
            : data.items.filter((i) => i.id === Number(filter.value)),
        single = items.length === 1 ? items[0] : null;
      const { t, body, head } = table([
        'Student',
        ...items.map(gradeCode),
        'Optional capped',
        'Total',
      ]);
      t.classList.add('gradebook-grid');
      head.lastElementChild.title = 'Optional points are capped at 15; the course total is capped at 100. Missing scores are not zeros.';
      items.forEach((item, index) => {
        const cell = head.children[index + 1];
        cell.title = item.title;
        cell.append(el('span', `/${item.max_points}`, { class: 'grade-max' }));
      });
      if (admin)
        items.forEach((item, index) => {
          const label = el('label', 'Released', { class: 'release-label' }),
            check = input('checkbox', `Release ${item.title}`);
          check.checked = item.released;
          check.addEventListener('change', () => {
            if (changes.size && !confirm('Discard unsaved scores and change release status?')) {
              check.checked = !check.checked;
              return;
            }
            run(() => backend.releaseItem(item.id, check.checked), 'Release status saved.');
          });
          label.prepend(check);
          head.children[index + 1].append(label);
        });
      const cells = [];
      data.roster.forEach((r, rowIndex) => {
        const tr = studentRow(r);
        tr.append(studentCell(r));
        const cellRow = [];
        for (const [column, item] of items.entries()) {
          const td = el('td'),
            grade = data.grades.find((g) => g.uni === r.uni && g.item_id === item.id),
            n = input('number', `${r.uni} ${item.title}`, grade?.score ?? '');
          n.min = '0';
          n.max = item.max_points;
          n.step = '.01';
          n.inputMode = 'decimal';
          n.dataset.grade = '';
          n.addEventListener('input', () => {
            changes.set(`${r.uni}:${item.id}`, {
              uni: r.uni,
              item_id: item.id,
              raw: n.value,
              max: item.max_points,
            });
            status.textContent = `${changes.size} unsaved score changes.`;
          });
          n.addEventListener('keydown', (e) => {
            if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
            e.preventDefault();
            const direction = e.key === 'ArrowUp' ? -1 : 1;
            let next;
            for (let row = rowIndex + direction; row >= 0 && row < cells.length; row += direction) {
              if (!cells[row][column].closest('tr').hidden) { next = cells[row][column]; break; }
            }
            if (next) {
              next.focus();
              next.select();
            }
          });
          td.append(n);
          tr.append(td);
          cellRow.push(n);
        }
        cells.push(cellRow);
        const total = gradeTotal(
          data.items,
          data.grades.filter((g) => g.uni === r.uni),
        );
        tr.append(
          el('td', total.bonus),
          el('td', `${total.total}${total.missing ? ' (incomplete)' : ''}`),
        );
        body.append(tr);
      });
      const toolbar = studentFilter(t, 'gradebook');
      toolbar.append(filter);
      content.append(toolbar);
      const save = button('Save scores', () =>
        run(async () => {
          const entries = [...changes.values()].map(({ raw, max, ...e }) => ({
            ...e,
            score: scoreValue(raw, max),
          }));
          if (!entries.length) throw new Error('No scores changed.');
          await backend.saveGrades(entries);
        }, 'Scores saved.'),
      );
      toolbar.append(save);
      toolbar.append(
        button(single ? `Export ${single.title} CSV` : 'Export gradebook CSV', () => {
          if (single)
            download(`item-${single.id}.csv`, [
              ['UNI', gradeCode(single)],
              ...data.roster.map((r) => [
                r.uni,
                data.grades.find((g) => g.uni === r.uni && g.item_id === single.id)?.score ?? '',
              ]),
            ]);
          else
            download('gradebook.csv', [
              ['UNI', 'Name', ...data.items.map(gradeCode), 'Optional capped', 'Total'],
              ...data.roster.map((r) => {
                const grades = data.grades.filter((g) => g.uni === r.uni),
                  total = gradeTotal(data.items, grades);
                return [
                  r.uni,
                  r.name,
                  ...data.items.map((i) => grades.find((g) => g.item_id === i.id)?.score ?? ''),
                  total.bonus,
                  total.total,
                ];
              }),
            ]);
        }),
      );
      content.append(wrapTable(t));
      const form = el('form', null, { class: 'admin-form' }),
        file = input('file', 'Grade CSV');
      file.accept = '.csv';
      file.required = true;
      labeled(
        form,
        single ? `CSV with UNI,${gradeCode(single)} (or uni,score)` : 'Gradebook CSV (export the template first)',
        file,
      );
      form.append(
        el(
          'p',
          'Import replaces scores in the supplied columns. Blank cells clear scores. Review the preview before saving.',
        ),
      );
      const preview = el('div'),
        submit = button('Preview grade import', () => {});
      submit.type = 'submit';
      form.append(submit, preview);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const text = await file.files[0].text(),
            entries = parseGradesCsv(text, single ? [single] : data.items, data.roster);
          preview.replaceChildren(el('p', `${entries.length} scores ready to import.`));
          const { t, body } = table(['UNI', 'Item', 'Score']);
          for (const e of entries) {
            const tr = el('tr');
            tr.append(
              el('td', e.uni),
              el('td', data.items.find((i) => i.id === e.item_id).title),
              el('td', e.score ?? 'Clear'),
            );
            body.append(tr);
          }
          preview.append(
            wrapTable(t),
            button('Import scores', () =>
              run(() => backend.saveGrades(entries), 'Scores imported.'),
            ),
          );
          file.addEventListener('change', () => preview.replaceChildren(), { once: true });
        } catch (error) {
          preview.replaceChildren(el('p', error.message));
        }
      });
      const csv = disclosure('Import scores CSV', 'grade-import');
      csv.append(form);
      content.append(csv);
    }
    filter.addEventListener('change', () => {
      if (changes.size && !confirm('Discard unsaved scores and change the selected item?')) {
        filter.value = selectedGradeItem;
        return;
      }
      selectedGradeItem = filter.value;
      draw();
    });
    draw();
  }
}
