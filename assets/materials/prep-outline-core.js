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
  const kind = name => exercises.includes(name) ? 'exercise' : 'lecture';
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
