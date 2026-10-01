import { csvCells, normalizeUni } from './core.js';
export const INSTRUCTOR_PAGES = ['roster', 'files', 'settings'];
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
  if (page === 'grades') return access?.role === 'student';
  if (page === 'groups') return z.class;
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
export function groupOpen(set, now = Date.now()) {
  return set.is_open && [set.deadline, set.submission_deadline].every(d => !d || new Date(d).getTime() > now);
}
export function checkGroupChange(data, access, setId, groupId, uni = access.uni) {
  if (!canWrite(access)) throw new Error('Student preview is read-only.');
  if (!['student', 'instructor'].includes(access.role)) throw new Error('Class access required.');
  const set = data.sets.find((s) => s.id === setId);
  if (!set) throw new Error('Group set not found.');
  if (access.role === 'student' && (uni !== access.uni || !groupOpen(set)))
    throw new Error('Sign-up is closed or this is not your membership.');
  if (groupId == null) return;
  if (!data.groups.some((g) => g.id === groupId && g.set_id === setId))
    throw new Error('Group not found in this set.');
  if (data.members.some((m) => m.group_id === groupId && m.uni === uni)) return;
  if (data.members.filter((m) => m.group_id === groupId).length >= set.max_size)
    throw new Error('This group is full.');
}
export function parsePresentCsv(text, roster) {
  if (text.length > 1_000_000) throw new Error('CSV must be smaller than 1 MB.');
  const rows = csvCells(text.replace(/^\uFEFF/, ''));
  const header = (rows[0] || []).map((c) => c.trim().toLowerCase());
  let index = header.findIndex((c) => ['uni', 'sis login id', 'login id'].includes(c));
  if (index >= 0) rows.shift();
  else index = 0;
  const seen = new Set();
  for (const row of rows) {
    const raw = (row[index] || '').trim().toLowerCase();
    const uni = normalizeUni(raw.endsWith('@columbia.edu') ? raw.split('@')[0] : raw);
    if (!uni || !roster.some((r) => r.uni === uni))
      throw new Error(`Unknown or invalid UNI: ${raw || '(empty)'}. Nothing was imported.`);
    seen.add(uni);
  }
  if (!seen.size) throw new Error('No UNIs found.');
  return [...seen].map((uni) => ({ uni, status: 'present' }));
}
export function scoreValue(raw, max) {
  if (String(raw).trim() === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(String(raw).trim()))
    throw new Error('Enter a score with at most two decimal places.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n > Number(max))
    throw new Error(`Score must be between 0 and ${max}.`);
  return n;
}
export function parseGradesCsv(text, items, roster) {
  if (text.length > 1_000_000) throw new Error('CSV must be smaller than 1 MB.');
  const [header = [], ...rows] = csvCells(text.replace(/^\uFEFF/, ''));
  const names = header.map((h) => h.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Duplicate CSV column names.');
  const uniColumn = names.indexOf('uni');
  if (uniColumn < 0) throw new Error('The CSV needs a UNI column.');
  const columns = names.map((h, index) => ({
    item: h === 'score' && items.length === 1 ? items[0] : items.find((i) => h === i.title.toLowerCase() || h === gradeCode(i).toLowerCase() || h === `item_${i.id}`),
    index,
  }));
  for (const [index, h] of names.entries())
    if (!['uni', 'name', 'total', 'optional capped'].includes(h) && !columns[index].item)
      throw new Error(`Unknown grade column: ${header[index]}.`);
  const itemIds = columns.filter((c) => c.item).map((c) => c.item.id);
  if (new Set(itemIds).size !== itemIds.length) throw new Error('Duplicate grade item columns.');
  if (!columns.some((c) => c.item))
    throw new Error('No grade item columns found. Export the template first.');
  const entries = [],
    seen = new Set();
  for (const row of rows) {
    const uni = normalizeUni(row[uniColumn] || '');
    if (row.length !== header.length || !uni || !roster.some((r) => r.uni === uni) || seen.has(uni))
      throw new Error(
        `Invalid or duplicate row for ${uni || '(missing UNI)'}. Nothing was imported.`,
      );
    seen.add(uni);
    for (const { item, index } of columns)
      if (item)
        entries.push({ uni, item_id: item.id, score: scoreValue(row[index], item.max_points) });
  }
  if (!entries.length) throw new Error('No grade rows found.');
  return entries;
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

export function parseQuizCsv(text, item, roster) {
  if (text.length > 1_000_000) throw new Error('CSV must be smaller than 1 MB.');
  const [header = [], ...rows] = csvCells(text.replace(/^\uFEFF/, ''));
  const h = header.map((s) => s.trim().toLowerCase());
  if (h.length !== 2 || !h.includes('uni') || !h.includes('score'))
    throw new Error('Use two CSV columns: uni,score.');
  return parseGradesCsv(
    toCsv([
      ['UNI', item.title],
      ...rows.map((row) => {
        if (row.length !== 2) throw new Error('Invalid CSV row.');
        return [row[h.indexOf('uni')], row[h.indexOf('score')]];
      }),
    ]),
    [item],
    roster,
  );
}
