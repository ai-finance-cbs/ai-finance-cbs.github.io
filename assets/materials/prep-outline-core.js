// Section wrappers remain ordinary Markdown. The comment distinguishes them from
// headings typed inside a note, so saving and reloading cannot move those notes.
const marker = '<!-- preparation-section -->';
export const OTHER_NOTES = 'Other notes';

export const QUIZ = 'Quiz (3 questions)';
// Logistics first, then the class plan in running order, then the appendix, then Other notes.
// A week without a set plan uses: Introduction, the Library topics, the quiz, the exercises.
export function preparationSections(outline) {
  const exercises = outline.exercises || [], appendix = outline.appendix || [];
  const plan = outline.plan || ['Introduction', ...outline.topics.map(t => t.name), QUIZ, ...exercises.filter(n => !appendix.includes(n))];
  // An exercise left out of both lists still gets a place at the end of the plan.
  const missing = exercises.filter(n => !plan.includes(n) && !appendix.includes(n));
  const kind = name => exercises.includes(name) ? 'exercise' : name === QUIZ ? 'quiz' : 'lecture';
  return [
    { name:'Logistics' },
    ...[...plan, ...missing].map(name => ({ name, kind:kind(name) })),
    ...appendix.map(name => ({ name, kind:kind(name), appendix:true })),
    { name:OTHER_NOTES },
  ];
}

export function parsePreparation(body, names) {
  const notes = Object.fromEntries(names.map(name => [name, '']));
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) || [];
  const clean = line => line?.replace(/\r?\n$/, '');
  const marked = /^## .+\r?\n<!-- preparation-section -->\r?\n/.test(body);
  const blocks = [];
  let offset = 0, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]), start = offset; offset += lines[i].length;
    const code = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marked && fence) {
      if (code && code[1][0] === fence[0] && code[1].length >= fence.length && !code[2].trim()) fence = null;
      continue;
    }
    if (!marked && code) { fence = code[1]; continue; }
    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!heading || (marked && clean(lines[i + 1]) !== marker)) continue;
    if (marked) offset += lines[++i].length;
    blocks.push({ name:heading[1], start, content:offset });
    // Other notes are always last. Their old headings must remain literal content.
    if (heading[1] === OTHER_NOTES) break;
  }
  const other = [], seen = new Set();
  const prefix = body.slice(0, blocks[0]?.start ?? body.length);
  if (prefix) other.push(prefix);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i], end = blocks[i + 1]?.start ?? body.length;
    let value = body.slice(block.content, end);
    if (!marked) value = value.replace(/^\r?\n/, '');
    value = value.replace(/\r?\n\r?\n$/, '');
    if (block.name === OTHER_NOTES) other.push(value);
    else if (names.includes(block.name) && !seen.has(block.name)) {
      notes[block.name] = value; seen.add(block.name);
    } else {
      // Keep unknown or duplicate headings and their text, including retired topics.
      other.push(marked ? `## ${block.name}\n${value}\n\n` : body.slice(block.start, end));
    }
  }
  notes[OTHER_NOTES] = other.join('');
  return notes;
}

export function serializePreparation(notes, names) {
  return names.filter(name => notes[name] !== '').map(name => `## ${name}\n${marker}\n${notes[name]}\n\n`).join('');
}

export const LAYOUT_MARKER = '<!-- preparation-layout v1 -->';
export const CARD_KINDS = ['lecture', 'exercise', 'quiz'];
const titleKey = name => name.trim().toLowerCase();
export function cardTitle(value, sections, currentName = null) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || [...name].length > 120 || /[\r\n\u2028\u2029]/.test(name))
    throw new Error('Enter a single-line title of 1–120 characters.');
  if (['logistics', 'other notes'].includes(titleKey(name))) throw new Error('That title is reserved.');
  if (/^(lecture|in-class exercise):\s*/i.test(name)) throw new Error('Enter the title without its type prefix.');
  if (sections.some(s => s.name !== currentName && titleKey(s.name) === titleKey(name)))
    throw new Error('Each card needs a unique title within the week.');
  return name;
}

// Legacy weeks continue using their public outline. A marked week owns its layout.
export function preparationDocument(body, outline) {
  if (!/^<!-- preparation-layout v1 -->\r?\n/.test(body)) {
    const sections = preparationSections(outline);
    return { layout:false, sections:sections.filter(s => s.name !== OTHER_NOTES),
      notes:parsePreparation(body, sections.map(s => s.name)) };
  }
  const content = body.slice(body.indexOf('\n') + 1), blocks = [];
  const pattern = /^##[ \t]+(.+?)[ \t]*\r?\n(<!-- preparation-section(?:[^\r\n]*?) -->)\r?\n/gm;
  for (const match of content.matchAll(pattern)) {
    blocks.push({ name:match[1], marker:match[2], start:match.index, content:match.index + match[0].length });
    // Unknown headings within this final block are literal notes, as in legacy weeks.
    if (titleKey(match[1]) === 'other notes') break;
  }
  const sections = [], entries = [], other = [content.slice(0, blocks[0]?.start ?? content.length)];
  let logistics = '';
  const seen = new Set();
  for (const [i, block] of blocks.entries()) {
    const end = blocks[i + 1]?.start ?? content.length;
    const value = content.slice(block.content, end).replace(/\r?\n\r?\n$/, '');
    if (titleKey(block.name) === 'other notes') { other.push(value); continue; }
    const type = /^<!-- preparation-section kind=(lecture|exercise|quiz|logistics)( appendix)? -->$/.exec(block.marker);
    const key = titleKey(block.name);
    let valid = !!type && !seen.has(key);
    if (key === 'logistics') valid &&= type[1] === 'logistics' && !type[2];
    else {
      try { cardTitle(block.name, sections); } catch { valid = false; }
      valid &&= type?.[1] !== 'logistics';
    }
    if (!valid) { other.push(content.slice(block.start, end)); continue; }
    seen.add(key);
    if (key === 'logistics') logistics = value;
    else { sections.push({ name:block.name, kind:type[1], ...(type[2] ? { appendix:true } : {}) }); entries.push([block.name, value]); }
  }
  return { layout:true,
    sections:[{ name:'Logistics', kind:'logistics' }, ...sections.filter(s => !s.appendix), ...sections.filter(s => s.appendix)],
    notes:Object.fromEntries([['Logistics', logistics], ...entries, [OTHER_NOTES, other.join('')]]) };
}

export function serializePreparationLayout({ sections, notes }) {
  const names = [];
  for (const section of sections.filter(s => s.name !== 'Logistics')) {
    cardTitle(section.name, names); names.push(section);
    if (!CARD_KINDS.includes(section.kind)) throw new Error('Choose Lecture, In-Class Exercise, or Quiz.');
  }
  const cards = [{ name:'Logistics', kind:'logistics' },
    ...sections.filter(s => s.name !== 'Logistics' && !s.appendix),
    ...sections.filter(s => s.name !== 'Logistics' && s.appendix),
    { name:OTHER_NOTES, kind:'lecture' }];
  return LAYOUT_MARKER + '\n' + cards.map(s =>
    `## ${s.name}\n<!-- preparation-section kind=${s.kind}${s.appendix ? ' appendix' : ''} -->\n${notes[s.name] ?? ''}\n\n`).join('');
}

// Moves stay inside a group unless a new group is explicitly selected.
export function movePreparationCard(sections, name, appendix, before = null) {
  const card = sections.find(s => s.name === name);
  if (!card || name === 'Logistics') throw new Error('Logistics stays first.');
  if (before === name) return sections;
  const group = sections.filter(s => s.name !== name && s.name !== 'Logistics' && !!s.appendix === appendix);
  const index = before == null ? group.length : group.findIndex(s => s.name === before);
  if (index < 0) throw new Error('Choose a card in the destination group.');
  const moved = { ...card }; if (appendix) moved.appendix = true; else delete moved.appendix;
  group.splice(index, 0, moved);
  const other = sections.filter(s => s.name !== name && s.name !== 'Logistics' && !!s.appendix !== appendix);
  return [sections.find(s => s.name === 'Logistics'), ...(appendix ? other : group), ...(appendix ? group : other)];
}
