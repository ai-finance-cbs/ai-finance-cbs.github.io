import {demoQuizPresent,demoQuizPosted} from './canvas-attendance-demo.js';
import { safeSubmission } from './submission-core.js';
import { refreshDemoLocks, demoSubmissionLocked, studentSubmissionItems } from './submission-demo.js';
import { GRADE_ITEMS, checkGroupChange, canWrite, scoreValue } from './class-core.js';
export function classSeed() {
  return {
    sessions: Array.from({ length: 6 }, (_, i) => ({ week: i + 1, date: null })),
    attendance: [],
    items: GRADE_ITEMS.map((i) => ({ ...i, released: i.id === 1 })),
    grades: [
      { uni: 'ab1234', item_id: 1, score: 8 },
      { uni: 'cd5678', item_id: 1, score: 9 },
    ],
    sets: [{ id: 'demo-set', title: 'Week 2 lab', max_size: 2, is_open: true, deadline: null }],
    groups: [
      { id: 'demo-group-1', set_id: 'demo-set', number: 1 },
      { id: 'demo-group-2', set_id: 'demo-set', number: 2 },
    ],
    members: [{ set_id: 'demo-set', group_id: 'demo-group-1', uni: 'cd5678' }],
    test_accounts: [{ email: 'teststudent@example.test', role: 'student', uni: 'test1' }],
  };
}
export function extendDemo({ read, save, user, saveUser, access }) {
  const requireAdmin = () => {
    const a = access();
    if (!canWrite(a) || a.role !== 'instructor')
      throw new Error('Instructor access required. Student preview is read-only.');
  };
  const requireGrader = () => {
    const a = access();
    if (!canWrite(a) || !['instructor', 'grader'].includes(a.role))
      throw new Error('Grading access required.');
  };
  const roster = (d) => [
    ...d.roster
      .filter((r) => !d.allowlist.some((a) => a.email === `${r.uni}@columbia.edu`))
      .map((r) => ({ ...r, email: `${r.uni}@columbia.edu` })),
    ...d.test_accounts
      .filter((t) => d.terms.find(term => term.id === d.term_id)?.status === 'active' && t.role === 'student' && !d.roster.some((r) => r.uni === t.uni))
      .map((t) => ({ uni: t.uni, name: `Test student ${t.uni}`, email: null, is_test: true })),
  ];
  // Synthetic history stays in local storage and is never included in student snapshots.
  function auditAttendance(d, old, row) {
    if (!old && !row) return;
    d.attendance_audit ||= [];
    d.attendance_audit.push({ actor_email: access().email, changed_at: new Date().toISOString(),
      old_row: old ? { ...old } : null, new_row: row ? { ...row } : null });
  }
  function snapshot(term) {
    const a = access(),
      d = read(term);
    if (!['student', 'grader', 'instructor', 'auditor'].includes(a?.role))
      throw new Error('Class access required.');
    const admin = a.role === 'instructor' && !a.view_as,
      students = roster(d);
    const shared = {
      term_id: d.term_id,
      files: d.files.filter(f => ['instructor','grader'].includes(a.role) || ((a.role !== 'auditor' || f.auditor_visible) && (f.released || (f.release_at && new Date(f.release_at).getTime() <= Date.now())))).map(({data,...f}) => f),
      assignments: d.assignments.filter(r => a.role !== 'auditor' || r.auditor_visible),
      announcements: d.announcements,
      submission_items: a.role === 'auditor' ? [] : a.role === 'student' ? studentSubmissionItems(d,a.uni) : d.items,
      submissions: a.role === 'auditor' ? [] : d.submissions.filter(s => admin || a.role === 'grader' || s.owner_uni === a.uni || d.members.some(m => m.group_id === s.group_id && m.uni === a.uni)).map(s => ({
        ...(a.role === 'student' ? {...safeSubmission(s),is_uploader:s.submitted_by===a.uni} : s), status:s.late ? 'Late' : 'Submitted', locked:demoSubmissionLocked(d,s.item_id,s.owner_uni,s.group_id),
        membership_changed: a.role !== 'student' && !!s.group_id && JSON.stringify(s.member_unis) !== JSON.stringify(d.members.filter(m => m.group_id === s.group_id).map(m => m.uni).sort()),
      })),
    };
    if (a.role === 'auditor') return { ...shared, sessions:d.sessions, attendance:[], items:[], grades:[], sets:[], groups:[], members:[] };
    if (a.role === 'grader')
      return {
        ...shared, group_grades:d.group_grades, sets:d.sets, groups:d.groups, members:d.members.map(m => ({...m,name:students.find(r => r.uni === m.uni)?.name,email:null})),
        roster: students.map(({ uni, name }) => ({ uni, name })),
        sessions: d.sessions,
        attendance: d.attendance,
        items: d.items,
        grades: d.grades,
      };
    return {
      ...shared,
      ...(admin ? { roster: students, group_grades:d.group_grades } : {}),
      sessions: d.sessions,
      attendance: d.attendance
        .filter((r) => admin || r.uni === a.uni)
        .map((r) => {
          if (admin) return r;
          const released = demoQuizPosted(d,d.term_id,a.uni,r.source_quiz);
          return {
            uni: r.uni,
            week: r.week,
            status: r.status,
            source_quiz: released ? r.source_quiz : null,
            manual_override: released ? r.manual_override : null,
          };
        }),
      items: d.items.filter((i) => admin || i.released),
      grades: d.grades.filter(
        (g) => admin || (g.uni === a.uni && d.items.find((i) => i.id === g.item_id)?.released),
      ),
      sets: d.sets,
      groups: d.groups,
      members: d.members
        .filter((m) => students.some((r) => r.uni === m.uni))
        .map((m) => ({
          ...m,
          uni: admin || m.uni === a.uni ? m.uni : null,
          name:
            admin || d.members.some((own) => own.uni === a.uni && own.group_id === m.group_id)
              ? students.find((r) => r.uni === m.uni)?.name || 'Student'
              : null,
          email:
            admin || d.members.some((own) => own.uni === a.uni && own.group_id === m.group_id)
              ? students.find((r) => r.uni === m.uni)?.email
              : null,
        })),

    };
  }
  return {
    async classData(term) {
      return snapshot(term);
    },
    async testAccounts() {
      requireAdmin();
      return read().test_accounts;
    },
    async setPreview(uni, term = null) {
      const u = user();
      if (access()?.actor_role !== 'instructor') throw new Error('Instructor access required.');
      // Validate with the real actor while keeping ordinary preview writes blocked.
      if (uni) {
        const old={...u};
        saveUser({...u,preview_uni:null,preview_term:null});
        try {
          const d=read(term);
          if (d.terms.find(t=>t.id===d.term_id)?.status==='closed' || !roster(d).some(r=>r.uni===uni)) throw new Error('Student not found.');
        } finally { saveUser(old); }
      }
      u.preview_uni = uni;
      u.preview_term = term;
      saveUser(u);
      return access();
    },
    async setSessionDate(week, date) {
      requireAdmin();
      const d = read();
      d.sessions.find((s) => s.week === week).date = date;
      save(d);
    },
    async saveAttendance(week, entries) {
      requireAdmin();
      const d = read();
      if (!d.sessions.some(s => s.week === week)) throw new Error('Invalid session.');
      if (!Array.isArray(entries) || entries.length > 5000) throw new Error('Invalid attendance rows.');
      for (const entry of entries) {
        if (!entry || !Object.hasOwn(entry, 'status') || !['excused', null].includes(entry.status))
          throw new Error('Only excuse or remove excuse is allowed.');
        if (!roster(d).some(r => r.uni === entry.uni)) throw new Error(`Unknown UNI: ${entry.uni}.`);
        const old = d.attendance.find(a => a.uni === entry.uni && a.week === week);
        const mapped=d.canvas?.[d.term_id]?.mappings.some(m=>m.kind==='quiz' && m.week===week);
        const quiz = mapped ? demoQuizPresent(d,d.term_id,entry.uni,week) : d.items.find(i => i.quiz_week === week && d.grades.some(g => g.item_id === i.id && g.uni === entry.uni));
        let row;
        if (entry.status === 'excused') {
          const reason = typeof entry.excuse_reason === 'string' ? entry.excuse_reason.trim() : '';
          if (!reason || [...reason].length > 300) throw new Error('An excuse reason of 1–300 characters is required.');
          if (quiz || old?.status === 'present') throw new Error('Present attendance cannot be excused. Correct quiz scores in CourseWorks.');
          row = { uni: entry.uni, week, status: 'excused', source_quiz: null, manual_override: true,
            excuse_reason: reason, excused_at: new Date().toISOString(), excused_by: access().email };
        } else {
          if (old?.status !== 'excused') continue;
          if (quiz) row = { canvas_derived:mapped, uni: entry.uni, week, status: 'present', source_quiz: week, manual_override: false,
            excuse_reason: null, excused_at: null, excused_by: null };
        }
        d.attendance = d.attendance.filter(a => a !== old);
        if (row) d.attendance.push(row);
        auditAttendance(d, old, row);
      }
      save(d);
    },
    async saveGrades(entries) {
      requireGrader();
      const d = read();
      for (const e of entries) {
        const item = d.items.find((i) => i.id === e.item_id);
        if (!item || !roster(d).some((r) => r.uni === e.uni)) throw new Error('Invalid grade row.');
        if (e.comment?.length > 10000) throw new Error('Comment is too long.');
        const score = e.score == null ? null : scoreValue(e.score, item.max_points);
        const old = d.grades.find(g => g.uni === e.uni && g.item_id === e.item_id);
        d.grades = d.grades.filter((g) => g.uni !== e.uni || g.item_id !== e.item_id);
        if (score != null) d.grades.push({ ...e, score, comment: 'comment' in e ? e.comment : old?.comment || null });
        if (item.quiz_week) {
          const record = d.attendance.find((a) => a.uni === e.uni && a.week === item.quiz_week);
          const before = record ? { ...record } : null;
          if (score == null) {
            if (record?.manual_override) record.source_quiz = null;
            else d.attendance = d.attendance.filter((a) => a !== record);
          } else if (record) {
            record.source_quiz = item.quiz_week;
            if (record.status === 'excused') Object.assign(record, { manual_override: false, excuse_reason: null, excused_at: null, excused_by: null });
            if (!record.manual_override) record.status = 'present';
          } else
            d.attendance.push({
              uni: e.uni,
              week: item.quiz_week,
              status: 'present',
              source_quiz: item.quiz_week,
              manual_override: false,
            });
          auditAttendance(d, before, d.attendance.find(a => a.uni === e.uni && a.week === item.quiz_week));
        }
      }
      refreshDemoLocks(d, entries.map(e => e.item_id));
      save(d);
    },
    async releaseItem(id, released) {
      requireAdmin();
      const d = read();
      d.items.find((i) => i.id === id).released = released;
      save(d);
    },
    async createSet(fields) {
      requireAdmin();
      const d = read(),
        id = crypto.randomUUID();
      d.sets.push({
        id,
        title: fields.title,
        max_size: fields.max_size,
        deadline: fields.deadline,
        is_open: true,
      });
      for (let i = 1; i <= fields.count; i++)
        d.groups.push({ id: crypto.randomUUID(), set_id: id, number: i });
      save(d);
    },
    async updateSet(id, is_open, deadline) {
      requireAdmin();
      const d = read();
      Object.assign(
        d.sets.find((s) => s.id === id),
        { is_open, deadline },
      );
      save(d);
    },
    async setGroupNote(id, note) {
      requireAdmin();const d=read(),set=d.sets.find(s=>s.id===id);
      if(!set)throw new Error('Group set not found in the active term.');
      if([...note].length>500 || /[\r\n]/.test(note))throw new Error('Enter one line, up to 500 characters.');
      set.note=note.trim();save(d);
    },
    async addGroups(id, count) {
      requireAdmin();const d=read();
      if(!d.sets.some(s=>s.id===id))throw new Error('Group set not found in the active term.');
      if(!Number.isInteger(count) || count<1 || count>100)throw new Error('Add between 1 and 100 groups.');
      const last=Math.max(0,...d.groups.filter(g=>g.set_id===id).map(g=>g.number));
      for(let n=1;n<=count;n++)d.groups.push({id:crypto.randomUUID(),set_id:id,number:last+n});
      save(d);
    },
    async chooseGroup(set, group, uni = null) {
      const d = read(),
        a = access(),
        target = a.role === 'instructor' ? uni : a.uni;
      checkGroupChange(d, a, set, group, target);
      const source=d.members.find(m=>m.set_id===set && m.uni===target)?.group_id;
      if (a.role==='student' && d.submissions.some(s=>[source,group].filter(Boolean).includes(s.group_id) && d.items.some(i=>i.id===s.item_id && i.group_set_id===set)))
        throw new Error('Groups with submitted work cannot be joined or left. Ask the instructor.');
      if (!roster(d).some((r) => r.uni === target)) throw new Error('Student not found.');
      d.members = d.members.filter((m) => m.set_id !== set || m.uni !== target);
      if (group) d.members.push({ set_id: set, group_id: group, uni: target });
      save(d);
    },
  };
}
