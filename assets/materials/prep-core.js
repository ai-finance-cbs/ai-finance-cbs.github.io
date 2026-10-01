export const SPEAKER_STATUSES = ['Idea', 'Contacted', 'Confirmed', 'Declined'];
export const SPEAKER_LIMITS = { name: 200, affiliation: 300, topic: 500, contact: 2000, notes: 10000 };
export function noteValues(week, body) {
  if (!Number.isInteger(week) || week < 1 || week > 6) throw new Error('Choose Week 1–6.');
  if (typeof body !== 'string' || [...body].length > 50000) throw new Error('Notes must be at most 50,000 characters.');
  return { week, body };
}
export function speakerValues(row) {
  const result = {};
  for (const [key, limit] of Object.entries(SPEAKER_LIMITS)) {
    if (typeof row[key] !== 'string' || [...row[key]].length > limit) throw new Error(`${key} must be at most ${limit.toLocaleString('en-US')} characters.`);
    result[key] = row[key];
  }
  result.name = result.name.trim();
  if (!result.name) throw new Error('Enter a name.');
  if (!SPEAKER_STATUSES.includes(row.status)) throw new Error('Choose a speaker status.');
  if (row.week != null && (!Number.isInteger(row.week) || row.week < 1 || row.week > 6)) throw new Error('Choose Week 1–6 or leave it blank.');
  return { ...result, week: row.week ?? null, status: row.status };
}
export function sortedSpeakers(rows, filter = '') {
  const query = filter.trim().toLowerCase();
  return rows.filter(row => ['name','affiliation','topic','week','status','contact','notes'].some(key => String(row[key] ?? '').toLowerCase().includes(query)))
    .sort((a, b) => SPEAKER_STATUSES.indexOf(a.status) - SPEAKER_STATUSES.indexOf(b.status) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const escape = text => text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Only explicit web/email links. No HTML, images, scripts, or embedded media.
export function safePrepLink(url) { return /^(?:https?:\/\/|mailto:)[^\s<>"']+$/i.test(url); }
function inline(text, depth = 0) {
  if (depth > 8) return escape(text);
  const tokens = /\[([^\[\]\n]+)\]\(([^\s()]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let html = '', offset = 0;
  for (const m of text.matchAll(tokens)) {
    html += escape(text.slice(offset, m.index));
    if (m[1] !== undefined) html += safePrepLink(m[2]) ? `<a href="${escape(m[2])}" rel="noopener noreferrer">${escape(m[1])}</a>` : escape(m[0]);
    else if (m[3] !== undefined || m[4] !== undefined) html += `<strong>${inline(m[3] ?? m[4], depth + 1)}</strong>`;
    else html += `<em>${inline(m[5] ?? m[6], depth + 1)}</em>`;
    offset = m.index + m[0].length;
  }
  return html + escape(text.slice(offset));
}
export function prepMarkdown(body) {
  const output = []; let paragraph = [], list = null;
  const flush = () => { if (paragraph.length) output.push(`<p>${inline(paragraph.join('\n'))}</p>`); paragraph = []; };
  const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line), item = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/.exec(line);
    if (heading) { flush(); closeList(); const n = heading[1].length; output.push(`<h${n}>${inline(heading[2])}</h${n}>`); }
    else if (item) { flush(); const type = item[1] ? 'ul' : 'ol'; if (list !== type) { closeList(); list = type; output.push(`<${list}>`); } output.push(`<li>${inline(item[2])}</li>`); }
    else if (!line.trim()) { flush(); closeList(); }
    else { closeList(); paragraph.push(line); }
  }
  flush(); closeList(); return output.join('\n');
}
