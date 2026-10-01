import {
  canWrite,
  gradeTotal,
  groupOpen,
  parsePresentCsv,
  parseGradesCsv,
  parseQuizCsv,
  scoreValue,
  toCsv,
} from './class-core.js';
let selectedGradeItem = 'all';
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
function wrapTable(table) {
  const w = el('div', null, {
    class: 'class-grid-wrap',
    tabindex: '0',
    'aria-label': 'Scrollable class table',
  });
  w.append(table);
  return w;
}
function table(headers) {
  const t = el('table', null, { class: 'class-grid' }),
    head = el('tr'),
    body = el('tbody');
  headers.forEach((h) => head.append(el('th', h, { scope: 'col' })));
  const thead = el('thead');
  thead.append(head);
  t.append(thead, body);
  return { t, body, head };
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
  const { t, body } = table(['Student', 'UNI', 'Groups', 'Present', 'Preview']);
  for (const r of data.roster) {
    const tr = el('tr'),
      memberships = data.members.filter((m) => m.uni === r.uni);
    const names = memberships.map(
      (m) =>
        `${data.sets.find((s) => s.id === m.set_id)?.title}: Group ${data.groups.find((g) => g.id === m.group_id)?.number}`,
    );
    const last = el('td');
    last.append(button(`View as ${r.name || r.uni}`, () => startPreview(r.uni)));
    tr.append(
      el('th', (r.name || r.uni) + (r.is_test ? ' (test)' : ''), { scope: 'row' }),
      el('td', r.uni),
      el('td', names.join('; ') || 'No group'),
      el(
        'td',
        `${data.attendance.filter((a) => a.uni === r.uni && a.status === 'present').length} / 6`,
      ),
      last,
    );
    body.append(tr);
  }
  root.append(wrapTable(t));
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
  const run = async (task, text, rerender = true) => {
    status.textContent = 'Saving…';
    try {
      await task();
      if (rerender) {
        await refresh();
        root.querySelector('[data-admin-status]')?.append(document.createTextNode(text));
      } else status.textContent = text;
    } catch (e) {
      status.textContent = e.message;
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
      ),
    );
    if (grading) {
      const { t, body, head } = table(['Student', ...data.sessions.map((s) => `Week ${s.week}`)]);
      data.sessions.forEach((s, i) => {
        const cell = head.children[i + 1],
          date = input('date', `Week ${s.week} date`, s.date || '');
        date.addEventListener('change', () =>
          run(
            () => backend.setSessionDate(s.week, date.value || null),
            'Session date saved.',
            false,
          ),
        );
        if (admin) cell.append(date);
        else cell.append(el('p', s.date || 'Date TBA'));
        cell.append(
          button(`Mark all present: Week ${s.week}`, () => {
            if (confirm(`Mark all ${data.roster.length} students present for Week ${s.week}?`))
              run(
                () =>
                  backend.saveAttendance(
                    s.week,
                    data.roster.map((r) => ({ uni: r.uni, status: 'present' })),
                  ),
                'Attendance saved.',
              );
          }),
        );
      });
      for (const r of data.roster) {
        const tr = el('tr');
        tr.append(el('th', `${r.name || r.uni} (${r.uni})`, { scope: 'row' }));
        for (const s of data.sessions) {
          const a = data.attendance.find((a) => a.uni === r.uni && a.week === s.week),
            td = el('td');
          const select = options(
            [
              ['', 'Use quiz or clear'],
              ['present', 'Present'],
              ['absent', 'Absent'],
              ['excused', 'Excused'],
            ],
            a?.status || '',
            `${r.uni} Week ${s.week} attendance`,
          );
          select.addEventListener('change', () =>
            run(
              () => backend.saveAttendance(s.week, [{ uni: r.uni, status: select.value || null }]),
              'Attendance saved.',
            ),
          );
          td.append(select, el('small', statusNote(a)));
          tr.append(td);
        }
        body.append(tr);
      }
      root.append(wrapTable(t));
      const s = section('Import attendance', 'attendance-import'),
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
    } else {
      const { t, body } = table(['Session', 'Date', 'Status', 'Source']);
      for (const s of data.sessions) {
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
      const s = section('My grades', 'my-grades');
      if (!data.items.length) s.append(el('p', 'No grades have been released yet.'));
      else {
        const { t, body } = table(['Item', 'Score', 'Maximum']);
        for (const i of data.items) {
          const score = data.grades.find((g) => g.item_id === i.id)?.score,
            tr = el('tr');
          tr.append(
            el('th', i.title, { scope: 'row' }),
            el('td', score ?? 'Not graded'),
            el('td', i.max_points),
          );
          body.append(tr);
        }
        s.append(
          wrapTable(t),
          el(
            'p',
            `Released points: ${gradeTotal(data.items, data.grades).total}. Optional points are capped at 15; course totals at 100.`,
          ),
        );
      }
      s.append(el('p', 'Only released items are shown. Blank scores are not zeros.'));
    }
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
      const list = el('div', null, { class: 'group-list' });
      for (const g of data.groups.filter((g) => g.set_id === set.id)) {
        const card = el('section', null, { class: 'group-row' }),
          members = data.members.filter((m) => m.group_id === g.id);
        card.append(
          el('h3', `Group ${g.number}${own?.group_id === g.id ? ' · Your group' : ''}`),
          el('p', `${set.max_size - members.length} slots remaining`),
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
        card.append(names);
        if (members.length && !members.some((m) => m.name))
          card.append(el('p', 'Join this group to see teammates.'));
        if (!admin && canWrite(access) && open) {
          if (own?.group_id === g.id)
            card.append(
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
            card.append(b);
          }
        }
        list.append(card);
      }
      s.append(list);
    }
  }
  if (page === 'gradebook') {
    root.append(
      el(
        'p',
        'Enter scores here or select one item for column entry. Quiz scores also record attendance.',
      ),
    );
    const filter = options(
      [['all', 'All grading items'], ...data.items.map((i) => [i.id, i.title])],
      selectedGradeItem,
      'Gradebook item',
    );
    labeled(root, 'Column entry', filter);
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
      if (single?.quiz_week)
        content.append(
          el(
            'p',
            `${single.title} records attendance for Week ${single.quiz_week}, including scores of zero. Manual attendance overrides are preserved.`,
          ),
        );
      const { t, body, head } = table([
        'Student',
        ...items.map((i) => `${i.title} / ${i.max_points}`),
        'Optional capped',
        'Recorded total',
      ]);
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
        const tr = el('tr');
        tr.append(el('th', `${r.name || r.uni} (${r.uni})`, { scope: 'row' }));
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
            let next;
            if (e.key === 'Enter' || e.key === 'ArrowDown') next = cells[rowIndex + 1]?.[column];
            if (e.key === 'ArrowUp') next = cells[rowIndex - 1]?.[column];
            if (next) {
              e.preventDefault();
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
      content.append(wrapTable(t));
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
      content.append(
        save,
        el(
          'p',
          'Enter or Arrow Down moves to the next student. Tab moves across columns. Blank means ungraded. Optional points cap at 15; totals cap at 100.',
        ),
      );
      content.append(
        button(single ? `Export ${single.title} CSV` : 'Export gradebook CSV', () => {
          if (single)
            download(`item-${single.id}.csv`, [
              ['uni', 'score'],
              ...data.roster.map((r) => [
                r.uni,
                data.grades.find((g) => g.uni === r.uni && g.item_id === single.id)?.score ?? '',
              ]),
            ]);
          else
            download('gradebook.csv', [
              ['UNI', 'Name', ...data.items.map((i) => i.title), 'Optional capped', 'Total'],
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
      const form = el('form', null, { class: 'admin-form' }),
        file = input('file', 'Grade CSV');
      file.accept = '.csv';
      file.required = true;
      labeled(
        form,
        single ? 'CSV with uni,score' : 'Gradebook CSV (export the template first)',
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
            entries = single
              ? parseQuizCsv(text, single, data.roster)
              : parseGradesCsv(text, data.items, data.roster);
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
      content.append(form);
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
