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
          if (admin || d.items.some((i) => i.quiz_week === r.source_quiz && i.released)) return r;
          return {
            uni: r.uni,
            week: r.week,
            status: r.status,
            source_quiz: null,
            manual_override: null,
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
      requireGrader();
      const d = read();
      for (const entry of entries) {
        if (!roster(d).some((r) => r.uni === entry.uni))
          throw new Error(`Unknown UNI: ${entry.uni}.`);
        const quiz = d.items.find(
          (i) =>
            i.quiz_week === week && d.grades.some((g) => g.item_id === i.id && g.uni === entry.uni),
        );
        d.attendance = d.attendance.filter((a) => a.uni !== entry.uni || a.week !== week);
        if (entry.status || quiz)
          d.attendance.push({
            uni: entry.uni,
            week,
            status: entry.status || 'present',
            source_quiz: quiz?.quiz_week || null,
            manual_override: !!entry.status,
          });
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
          if (score == null) {
            if (record?.manual_override) record.source_quiz = null;
            else d.attendance = d.attendance.filter((a) => a !== record);
          } else if (record) {
            record.source_quiz = item.quiz_week;
            if (!record.manual_override) record.status = 'present';
          } else
            d.attendance.push({
              uni: e.uni,
              week: item.quiz_week,
              status: 'present',
              source_quiz: item.quiz_week,
              manual_override: false,
            });
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
