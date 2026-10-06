export const INSTRUCTOR_PAGES = ['roster', 'files', 'settings', 'preparation', 'speakers'];
export const CLASS_PAGES = ['gradebook', 'attendance', 'grades', 'groups'];
export const GRADE_ITEMS = [
  ...Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    title: `Milestone #${i + 1}`,
    max_points: 10,
  })),
  { id: 6, title: 'Final Prototype', max_points: 25 },
  ...Array.from({ length: 5 }, (_, i) => ({
    id: i + 7,
    title: `In-class quiz ${i + 1}`,
    max_points: 3,
    quiz_week: i + 1,
  })),
  { id: 12, title: 'Participation and attendance', max_points: 10 },
  ...['Confidently Wrong', 'Right for the Wrong Reason', 'In the Wild', 'Share Your Setup'].map(
    (title, i) => ({ id: 13 + i, title, max_points: i === 3 ? 5 : 10, optional: true }),
  ),
].map((i) => ({ optional: false, released: false, ...i }));
// New terms keep explicit codes; legacy data uses the original migration 003 IDs.
export function gradeCode(item) {
  if (item.code) return item.code;
  const id = Number(item.id);
  if (id <= 5) return `M${id}`;
  if (id === 6) return 'FP';
  if (id <= 11) return `Q${id - 6}`;
  if (id === 12) return 'PA';
  return `O${id - 12}`;
}
export function zones(access) {
  const role = access?.role;
  return {
    materials: ['instructor', 'grader', 'student', 'auditor'].includes(role),
    class: ['instructor', 'student'].includes(role),
    grading: ['instructor', 'grader'].includes(role) && !access?.view_as,
    instructor: role === 'instructor' && !access?.view_as,
  };
}
export function pageAllowed(page, access) {
  const z = zones(access);
  if (INSTRUCTOR_PAGES.includes(page)) return z.instructor;
  if (page === 'gradebook') return z.grading;
  if (page === 'attendance') return z.class || z.grading;
  if (page === 'submit') return false;
  if (page === 'grades') return access?.role === 'student';
  if (page === 'groups') return z.class || z.grading;
  return z.materials;
}
export function canWrite(access) {
  return !!access && !access.view_as && !access.read_only && ['instructor', 'grader', 'student'].includes(access.role);
}
export function gradeTotal(items, grades) {
  let core = 0,
    optional = 0,
    missing = 0;
  for (const item of items) {
    const score = grades.find((g) => g.item_id === item.id)?.score;
    if (score == null) {
      missing++;
      continue;
    }
    if (item.optional) optional += Number(score);
    else core += Number(score);
  }
  return {
    core,
    optional,
    bonus: Math.min(15, optional),
    total: Math.min(100, core + Math.min(15, optional)),
    missing,
  };
}
// Quote all cells and neutralize spreadsheet formulas in text exports.
export function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let s = String(value ?? '');
          if (/^[=+@-]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
}
