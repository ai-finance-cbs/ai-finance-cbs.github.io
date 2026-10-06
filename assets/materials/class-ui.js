import {canvasHealth} from './canvas-student-ui.js';
import { installStudentProfiles } from './profile-ui.js';
import { renderGradePanel } from './grade-panel.js';
import { gradingSubmission, groupOverride, newYorkInput, newYorkTime } from './staff-core.js';
import { courseTime } from './week-core.js';
import {
  canWrite,
  gradeTotal,
  gradeCode,
  parseGradesCsv,
  scoreValue,
  toCsv,
} from './class-core.js';
let selectedGradeItem = 'all';
let selectedGradeCell = null;
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
  identity.append(el('button', student.name || student.uni, { type:'button', class:'student-name student-profile-link', 'data-student-profile':student.uni }), el('span', student.uni, { class: 'student-uni' }));
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
// Canvas-style: clicking a cell opens a small pop-up. Only an excuse can be added or removed by hand.
function attendanceDialog({ student, week, state, record, editable, save }) {
  const dialog = el('dialog', null, { class: 'attendance-confirm', 'aria-label': `${student} Week ${week} attendance` });
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(el('h3', `${student} · Week ${week}`));
  const actions = el('div', null, { class: 'attendance-confirm-actions' });
  if (state === 'present') {
    dialog.append(el('p', `Present${record?.source_quiz ? ` (Quiz ${record.source_quiz} score recorded)` : ''}. To change this, edit the quiz score in CourseWorks.`));
    actions.append(button('Close', close));
  } else if (!editable) {
    dialog.append(el('p', state === 'excused' ? `Excused${record?.excuse_reason ? `: ${record.excuse_reason}` : ''}.` : 'Absent: no quiz score for this week.'));
    actions.append(button('Close', close));
  } else if (state === 'excused') {
    dialog.append(el('p', `Excused${record?.excuse_reason ? `: ${record.excuse_reason}` : ''}. Attendance normally comes from quiz scores.`), el('p', 'Do you really want to change the attendance?', { class: 'attendance-question' }));
    const remove = button('Remove excuse', async () => { remove.disabled = true; if (await save({ status: null })) close(); else remove.disabled = false; });
    actions.append(remove, button('Cancel', close));
  } else {
    dialog.append(el('p', 'Absent: no quiz score for this week. Attendance normally comes from quiz scores.'), el('p', 'Do you really want to change the attendance?', { class: 'attendance-question' }));
    const reason = el('textarea', null, { required: '', maxlength: '300', rows: '3', 'aria-label': 'Excuse reason', placeholder: 'Reason (required)' });
    const ok = button('Excuse absence', async () => {
      if (!reason.value.trim()) { reason.setCustomValidity('Enter an excuse reason.'); reason.reportValidity(); return; }
      ok.disabled = true; if (await save({ status: 'excused', excuse_reason: reason.value.trim() })) close(); else ok.disabled = false;
    });
    reason.addEventListener('input', () => reason.setCustomValidity(''));
    dialog.append(reason); actions.append(ok, button('Cancel', close));
  }
  const error = el('p', '', { class: 'attendance-dialog-error', role: 'alert' });
  dialog.append(error, actions);
  const original = save;
  save = async entry => { error.textContent = ''; const ok = await original(entry); if (!ok) error.textContent = document.querySelector('[data-admin-status]')?.textContent || 'Could not save.'; return ok; };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dialog); dialog.showModal();
  (dialog.querySelector('textarea') || actions.lastElementChild).focus();
}
function statusNote(a) {
  if (!a) return '';
  if (a.status === 'excused') return 'Instructor excuse';
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
  installStudentProfiles(ctx);
}
export function renderClassPage(ctx) {
  const { root, page, data, backend, access, refresh } = ctx;
  const admin = access.role === 'instructor' && !access.view_as;
  const grading = ['instructor', 'grader'].includes(access.role) && !access.view_as;
  let openProfileGrade;
  const status = el('p', '', {
    class: 'materials-status',
    role: 'status',
    'data-admin-status': '',
  });
  root.append(status);
  let saving = false;
  const run = async (task, text, rerender = true) => {
    if (!canWrite(access)) { status.textContent = 'Archived terms and preview are read-only.'; return false; }
    if (saving) return false;
    saving = true;
    status.textContent = 'Saving…';
    const focusLabel = document.activeElement?.getAttribute('aria-label');
    const positions = [...root.querySelectorAll('.class-grid-wrap')].map(w => [w.scrollLeft, w.scrollTop]);
    try {
      await task();
      if (rerender) {
        await refresh();
        // The mode container is replaced when the page refreshes.
        const currentRoot = ctx.currentRoot?.() || root;
        currentRoot.querySelector('[data-admin-status]')?.append(document.createTextNode(text));
        [...currentRoot.querySelectorAll('.class-grid-wrap')].forEach((w, i) => {
          if (positions[i]) [w.scrollLeft, w.scrollTop] = positions[i];
        });
        if (focusLabel) [...currentRoot.querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
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
    const unavailable=ctx.canvas && !ctx.canvas.available;
    if(ctx.canvas)root.append(canvasHealth(ctx.canvas));
    if (grading) {
      const { t, body, head } = table(['Student', ...data.sessions.map((s) => `Week ${s.week}`)]);
      const classUnis = new Set(data.roster.map(r => r.uni));
      t.classList.add('attendance-grid');
      // Session dates come from the class schedule; nobody edits them here.
      data.sessions.forEach((s, i) => head.children[i + 1].append(el('span', s.date ? new Date(`${s.date}T12:00:00`).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : 'Date TBA', { class: 'session-date' })));
      const totals = el('tr', null, { class: 'attendance-totals' });
      totals.append(el('th', 'Class totals', { scope: 'row' }));
      for (const s of data.sessions) {
        const cell = el('td', null, { 'aria-label': `Week ${s.week} totals` });
        const count = value => data.attendance.filter(a => classUnis.has(a.uni) && a.week === s.week && a.status === value).length;
        const present = count('present'), excused = count('excused');
        // Absent is only counted once the class has happened; before that a blank cell means nothing yet.
        const held = s.date && s.date <= new Date().toISOString().slice(0, 10);
        for (const [value, n] of [['present', present], ['absent', held ? data.roster.length - present - excused : '—'], ['excused', excused]])
          cell.append(el('span', `${value[0].toUpperCase()}${value.slice(1)} ${unavailable?'—':n}`, { class: `total-${value}` }));
        totals.append(cell);
      }
      body.append(totals);
      for (const r of data.roster) {
        const tr = studentRow(r);
        tr.append(studentCell(r));
        for (const s of data.sessions) {
          const a = data.attendance.find((a) => a.uni === r.uni && a.week === s.week),
            td = el('td');
          td.setAttribute('aria-label', `${r.uni} Week ${s.week} attendance`);
          const state = unavailable ? 'Status unavailable' : a?.status || 'absent';
          const mark = el('button', state === 'present' ? '✓' : state === 'excused' ? 'EX' : '–', {
            type: 'button', class: `attendance-mark mark-${state}`, 'aria-label': `${r.name || r.uni} Week ${s.week}: ${state}`,
            ...(state === 'excused' && a.excuse_reason ? { title: a.excuse_reason } : {}),
          });
          mark.disabled=!!unavailable;
          mark.addEventListener('click', () => attendanceDialog({
            student: r.name || r.uni, week: s.week, state, record: a, editable: admin && canWrite(access),
            save: entry => run(() => backend.saveAttendance(s.week, [{ uni: r.uni, ...entry }]), entry.status ? 'Absence excused.' : 'Excuse removed.'),
          }));
          td.append(mark);
          if (a?.source_quiz && !unavailable) {
            const source = el('span', `Q${a.source_quiz}${a.manual_override ? '*' : ''}`, { class: 'quiz-marker', title: statusNote(a) });
            source.append(el('span', ` ${statusNote(a)}`, { class: 'sr-only' }));
            td.append(source);
          }
          tr.append(td);
        }
        body.append(tr);
      }
      const bar = el('p', 'Attendance comes from Canvas quiz scores. Click a cell for details; only the instructor can excuse an absence.', { class: 'attendance-legend' });
      root.append(bar, studentFilter(t, 'attendance'), wrapTable(t));
    } else {
      const { t, body } = table(['Session', 'Date', 'Status', 'Source']);
      t.classList.add('student-attendance-grid');
      for (const s of data.sessions.filter(s => s.week >= 1 && s.week <= 6).sort((a,b) => a.week - b.week)) {
        const a = data.attendance.find((a) => a.week === s.week),
          tr = el('tr');
        tr.append(
          el('th', `Week ${s.week}`, { scope: 'row' }),
          el('td', s.date || 'Date TBA'),
          el('td', unavailable ? 'Status unavailable' : { present: 'Present', absent: 'Absent', excused: 'Excused' }[a?.status] || 'Absent'),
          el('td', a && !unavailable ? statusNote(a) : ''),
        );
        body.append(tr);
      }
      root.append(wrapTable(t));
    }
  }
  if (page === 'gradebook') {
    const legend = disclosure('Legend', 'grade-legend');
    const legendList = el('ul');
    for (const item of data.items) {
      const note = item.optional ? ' · Optional tasks are capped at 15 points total.' : item.quiz_week ? ' · A quiz score marks attendance present.' : '';
      legendList.append(el('li', `${gradeCode(item)} → ${item.title} → ${item.max_points} points${note}`));
    }
    legend.append(el('p', 'Hidden: scores and comments stay private. Visible: students can see their scores and comments.', { 'data-visibility-legend':'' }), el('p', 'Quiz scores mark attendance. Enter / ↓ moves down; Tab moves across; F2 opens the submission panel. Blank scores are ungraded. S = Submitted; L = Late; • = a score differs from the group grade.'), legendList);
    root.append(legend);
    const filter = options(
      [['all', 'All grading items'], ...data.items.map((i) => [i.id, gradeCode(i)])],
      selectedGradeItem,
      'Gradebook item',
    );
    filter.title = 'Jump to one grading item or show all columns.';
    const workspace = el('div', null, { class: 'gradebook-workspace' });
    const content = el('div', null, { class: 'gradebook-content' });
    const panel = el('aside', null, { class: 'grade-panel', 'aria-labelledby': 'grade-panel-title' }); panel.hidden = true;
    workspace.append(content, panel);
    const changes = new Map();
    root.append(workspace);
    const openPanel = (item, student) => {
      delete panel.dataset.profileUni;panel.setAttribute('aria-labelledby','grade-panel-title');
      selectedGradeCell = { item: item.id, uni: student.uni }; workspace.classList.add('panel-open');
      renderGradePanel({ panel, data, item, student, backend, role: access.role, readOnly: !canWrite(access),
        save: async (task, message) => { if (changes.size) throw new Error('Save grid changes before grading in the panel.'); if (!await run(task, message)) throw new Error(status.textContent); },
        close: () => { selectedGradeCell = null; panel.hidden = true; workspace.classList.remove('panel-open'); },
      });
    };
    openProfileGrade = openPanel;
    function draw() {
      changes.clear();
      content.replaceChildren();
      const releasePrompt = el('div', null, { class:'grade-release-confirm', role:'group', 'aria-label':'Release confirmation' });
      releasePrompt.hidden = true;
      let releaseControl;
      const dismissRelease = () => {
        releasePrompt.hidden = true; releasePrompt.replaceChildren();
        if (releaseControl) { releaseControl.disabled = !canWrite(access); releaseControl.focus({ preventScroll:true }); }
        releaseControl = null;
      };
      const items =
          filter.value === 'all'
            ? data.items
            : data.items.filter((i) => i.id === Number(filter.value)),
        single = items.length === 1 ? items[0] : null;
      const { t, body, head } = table([
        'Student',
        ...items.map(gradeCode),
        'Total (visible)',
      ]);
      t.classList.add('gradebook-grid');
      head.lastElementChild.append(el('span', 'incl. hidden', { class:'grade-total-hidden' }));
      head.lastElementChild.title = 'First line: the student’s visible total. Second line: all recorded scores, including hidden items. Optional points are capped at 15; totals are capped at 100. Missing scores are not zeros.';
      items.forEach((item, index) => {
        const cell = head.children[index + 1];
        cell.title = item.title;
        cell.append(el('span', `/${item.max_points}`, { class: 'grade-max' }));
        const code = gradeCode(item), state = item.released ? 'Visible' : 'Hidden';
        const control = el(admin ? 'button' : 'span', state, {
          class:'grade-visibility', 'data-release-state':state.toLowerCase(), 'data-release-item':item.id,
          'aria-label':`${code} visibility: ${state}`,
        });
        if (admin) {
          control.type = 'button'; control.disabled = !canWrite(access);
          control.setAttribute('aria-pressed', String(item.released));
          control.addEventListener('click', async () => {
            if (saving) return;
            if (changes.size) {
              status.textContent = 'Save scores before changing release status.';
              return;
            }
            dismissRelease();
            control.disabled = true;
            if (item.released) {
              await run(() => backend.releaseItem(item.id, false), 'Release status saved.');
              control.disabled = !canWrite(access);
              root.querySelector(`[data-release-item="${item.id}"]`)?.focus({ preventScroll:true });
              return;
            }
            releaseControl = control;
            const confirm = button('Show scores', async () => {
              // Scores can change while confirmation is open. Never discard those edits on release.
              if (changes.size) { status.textContent = 'Save scores before changing release status.'; dismissRelease(); return; }
              releasePrompt.querySelectorAll('button').forEach(b => b.disabled = true);
              await run(() => backend.releaseItem(item.id, true), 'Release status saved.');
              dismissRelease();
              root.querySelector(`[data-release-item="${item.id}"]`)?.focus({ preventScroll:true });
            });
            const cancel = button('Cancel', dismissRelease);
            releasePrompt.replaceChildren(el('span', `Show ${code} scores and comments to students?`), confirm, cancel);
            releasePrompt.hidden = false; cancel.focus({ preventScroll:true });
          });
        }
        cell.append(control);
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
          td.dataset.gradeCell = `${r.uni}:${item.id}`;
          td.dataset.releaseState = item.released ? 'visible' : 'hidden';
          td.addEventListener('click', () => openPanel(item, r));
          if (!canWrite(access)) {
            // Disabled inputs swallow clicks. Keep archived submission details reachable by mouse and keyboard.
            n.style.pointerEvents = 'none';
            td.tabIndex = 0; td.setAttribute('role', 'button');
            td.setAttribute('aria-label', `View archived ${item.title} for ${r.name || r.uni}`);
            td.addEventListener('keydown', e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(item, r); }
            });
          }
          n.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); openPanel(item, r); panel.querySelector('input')?.focus(); } });
          const submission = gradingSubmission(data, item, r.uni);
          if (submission) td.append(el('span', submission.late ? 'L' : 'S', { class: 'submission-mark', title: submission.late ? 'Late' : 'Submitted', 'aria-label': submission.late ? 'Late' : 'Submitted' }));
          if (groupOverride(data, item, r.uni, submission)) td.append(el('span', '•', { class: 'override-mark', title: 'Score differs from group grade', 'aria-label': 'Score differs from group grade' }));
          td.append(n);
          tr.append(td);
          cellRow.push(n);
        }
        cells.push(cellRow);
        const grades = data.grades.filter(g => g.uni === r.uni);
        const visible = gradeTotal(data.items.filter(i => i.released), grades), total = gradeTotal(data.items, grades);
        const totals = el('td', null, { title: `${total.missing} ungraded items; optional points capped at ${total.bonus}.`, class:'gradebook-total' });
        totals.append(el('span', visible.total, { 'data-visible-total':'', 'aria-label':`Visible total: ${visible.total}` }),
          el('span', total.total, { class:'grade-total-hidden', 'data-all-total':'', 'aria-label':`Total including hidden: ${total.total}` }));
        tr.append(totals);
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
      content.append(releasePrompt, wrapTable(t));
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
      if (!canWrite(access)) {
        content.querySelectorAll('input[data-grade], #grade-import input, #grade-import button').forEach(n => n.disabled = true);
        save.disabled = true;
      }
    }
    filter.addEventListener('change', () => {
      if (changes.size) {
        status.textContent = 'Save scores before changing the selected item.';
        filter.value = selectedGradeItem;
        return;
      }
      selectedGradeItem = filter.value;
      draw();
    });
    draw();
    if (selectedGradeCell) {
      const item = data.items.find(i => i.id === selectedGradeCell.item), student = data.roster.find(r => r.uni === selectedGradeCell.uni);
      if (item && student) openPanel(item, student); else selectedGradeCell = null;
    }
  }
  if (grading && ['attendance','gradebook'].includes(page)) installStudentProfiles({...ctx,openGrade:openProfileGrade,onOpen:()=>{selectedGradeCell=null;}});
}
