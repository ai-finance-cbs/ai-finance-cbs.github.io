import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { OTHER_NOTES, preparationSections, parsePreparation, serializePreparation } from '../assets/materials/prep-outline-core.js';
import { noteValues } from '../assets/materials/prep-core.js';

// Ruby/YAML is already required by the Jekyll build. Compare generated JSON to its sources.
const data = JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e',
  'puts %w[weeks library materials].to_h { |name| [name, YAML.load_file("_data/#{name}.yml")] }.to_json'],
  { cwd:new URL('../',import.meta.url),encoding:'utf8' }));
const outlines = data.weeks.map(week => ({
  goal:week.goal, exercises:week.exercises, plan:week.prep_plan ?? null, appendix:week.prep_appendix ?? null,
  topics:data.library.find(entry => entry.week === week.number).topics.map(name => ({ name,
    readings:['required','recommended'].flatMap(level => data.materials.filter(item => item.week === week.number && item.topic === name && item.level === level)
      .map(({title,author,url,level}) => ({title,author:author ?? null,url:url ?? null,level}))),
  })),
}));
const names = preparationSections(outlines[0]).map(section => section.name);

test('all six built Preparation outlines match Library order, Syllabus exercises, and public reference readings',() => {
  for (const [index,expected] of outlines.entries()) {
    const html = readFileSync(new URL(`../_site/materials/preparation/week-${index+1}/index.html`,import.meta.url),'utf8');
    const json = html.match(/<script type="application\/json" data-preparation-outline>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(json); assert.deepEqual(JSON.parse(json),expected);
    assert.doesNotMatch(json,/<\/?script|body_md|updated_at|instructor_notes/);
    const sections = preparationSections(expected);
    const plan = expected.plan || ['Introduction',...expected.topics.map(t => t.name),'Quiz (3 questions)',...expected.exercises];
    assert.deepEqual(sections.map(s => s.name),['Logistics',...plan,...(expected.appendix || []),'Other notes']);
    assert.deepEqual(sections.filter(s => s.kind === 'exercise').map(s => s.name).sort(),[...expected.exercises].sort());
    assert.deepEqual(sections.filter(s => s.appendix).map(s => s.name),expected.appendix || []);
  }
  const landing = readFileSync(new URL('../_site/materials/preparation/index.html',import.meta.url),'utf8');
  assert.deepEqual(JSON.parse(landing.match(/data-preparation-outline>([\s\S]*?)<\/script>/)[1]),outlines[0]);
  const speakers = readFileSync(new URL('../_site/materials/speakers/index.html',import.meta.url),'utf8');
  assert.deepEqual(JSON.parse(speakers.match(/data-speaker-weeks>([\s\S]*?)<\/script>/)[1]),
    data.library.filter(w=>w.week>=1 && w.week<=6).map(({week,title})=>({week,title})));
});

test('serialization round-trips every section, whitespace, nested headings, HTML, fences, and Unicode',() => {
  const notes = Object.fromEntries(names.map((name,index) => [name,`\nDraft ${index}: 🌐\r\n\n## Logistics\n\n## Unknown subheading\n\n\`\`\`md\n## Quiz (3 questions)\n\`\`\`\n<script>private</script>\n\n`]));
  const body = serializePreparation(notes,names);
  assert.deepEqual(parsePreparation(body,names),notes);
  assert.equal(serializePreparation(parsePreparation(body,names),names),body);
  const unfinished = {...notes,[names[0]]:'```md\nAn unfinished example must not swallow the next section.'};
  assert.deepEqual(parsePreparation(serializePreparation(unfinished,names),names),unfinished);
  assert.ok(body.includes('## Economic Frameworks for AI\n'));
  const empty = parsePreparation('',names); assert.equal(serializePreparation(empty,names),'');
});

test('legacy free-form notes remain intact under Other notes, including unknown headings',() => {
  for (const body of ['Opening draft\n\n- First\n- Second\n', '# Opening\n\n## Unmapped old topic\nRetain everything.\n', '```md\n## Logistics\n```\nKeep the example.']) {
    const parsed = parsePreparation(body,names);
    // Unknown blocks retain their headings and text, not just the recognized outline.
    assert.ok(parsed[OTHER_NOTES].includes(body));
    assert.deepEqual(parsePreparation(serializePreparation(parsed,names),names),parsed);
    for (const name of names.filter(n => n !== OTHER_NOTES)) assert.equal(parsed[name],'');
  }
});

test('unmarked section notes, unknown blocks, duplicates, and retired topics survive conversion',() => {
  const body = 'Opening text\n\n## Logistics\n\nRoom A\n\n## Unknown\nKeep this\n\n## Logistics\nDuplicate room note\n\n## Quiz (3 questions)\nQuestion one\n';
  const parsed = parsePreparation(body,names);
  assert.equal(parsed.Logistics,'Room A'); assert.equal(parsed['Quiz (3 questions)'],'Question one\n');
  for (const text of ['Opening text','## Unknown\nKeep this','## Logistics\nDuplicate room note']) assert.ok(parsed[OTHER_NOTES].includes(text));
  assert.deepEqual(parsePreparation(serializePreparation(parsed,names),names),parsed);
  const renamed = names.map(name => name === names[0] ? 'Renamed topic' : name);
  const before = {...parsePreparation('',names),[names[0]]:'Do not lose this retired topic.'};
  const after = parsePreparation(serializePreparation(before,names),renamed);
  assert.ok(after[OTHER_NOTES].includes(`## ${names[0]}\nDo not lose this retired topic.`));
  assert.deepEqual(parsePreparation(serializePreparation(after,renamed),renamed),after);
});

test('a section save preserves every other saved section and enforces the whole-week size limit',() => {
  const saved = {...parsePreparation('',names),Logistics:'Keep room note',[OTHER_NOTES]:'Keep legacy note'};
  const changed = {...saved,[names[0]]:'New topic note'};
  assert.deepEqual(parsePreparation(serializePreparation(changed,names),names),changed);
  assert.throws(() => noteValues(1,serializePreparation({...saved,Logistics:'x'.repeat(50000)},names)),/50,000/);
  assert.equal(saved.Logistics,'Keep room note');
});

const { LAYOUT_MARKER, preparationDocument, serializePreparationLayout, cardTitle, movePreparationCard } = await import('../assets/materials/prep-outline-core.js');
const outline = { topics:[{name:'Evidence'},{name:'Decisions'}], exercises:['Memo exercise'], appendix:['Memo exercise'] };

test('v1 round-trips order, empty cards, types, appendix, hidden notes, and nested Markdown', () => {
  const doc = preparationDocument('',outline);
  doc.notes.Logistics = 'Room A';
  doc.notes.Evidence = '\n## Nested heading\n\n```md\n## Another heading\n```\n<script>text only</script> 🌐\n\n';
  doc.notes[OTHER_NOTES] = 'Retired\n## An old heading\nKeep this exactly.\n';
  doc.sections = movePreparationCard(doc.sections,'Memo exercise',false,'Evidence');
  doc.sections = movePreparationCard(doc.sections,'Decisions',true);
  const body = serializePreparationLayout(doc), parsed = preparationDocument(body,{});
  assert.ok(body.startsWith(LAYOUT_MARKER+'\n'));
  assert.deepEqual(parsed, {...doc,layout:true,sections:doc.sections.map(s=>s.name==='Logistics'?{...s,kind:'logistics'}:s)});
  assert.equal(serializePreparationLayout(parsed),body);
  assert.ok(body.includes('## Introduction\n<!-- preparation-section kind=lecture -->\n\n\n'));
  assert.ok(body.includes('## Decisions\n<!-- preparation-section kind=lecture appendix -->'));
  assert.deepEqual(preparationDocument(body,{topics:[{name:'Changed default'}]}),parsed);
  assert.deepEqual(preparationDocument(body.replaceAll('\n','\r\n'),{}).sections,parsed.sections);
});

test('no layout line keeps legacy defaults and conversion keeps every saved and hidden note', () => {
  const body = 'Preamble\n\n## Logistics\nRoom A\n\n## Evidence\nKeep evidence\n\n## Retired\nRetired content\n\n## Evidence\nDuplicate content';
  const doc = preparationDocument(body,outline), all = preparationSections(outline).map(s=>s.name);
  assert.equal(doc.layout,false); assert.deepEqual(doc.notes,parsePreparation(body,all));
  assert.deepEqual(doc.sections,preparationSections(outline).filter(s=>s.name!==OTHER_NOTES));
  const saved = serializePreparation(doc.notes,all);
  assert.equal(saved,serializePreparation(parsePreparation(body,all),all));
  const parsed = preparationDocument(serializePreparationLayout(doc),{});
  assert.deepEqual(parsed.notes,doc.notes);
  for (const text of ['Preamble','Retired content','Duplicate content']) assert.ok(parsed.notes[OTHER_NOTES].includes(text));
  assert.equal(parsed.sections[0].kind,'logistics');
  assert.equal(parsed.sections.length,doc.sections.length);
});

test('v1 malformed markers, reserved titles, and duplicate names stay hidden without losing content', () => {
  const body = LAYOUT_MARKER+'\nPreamble\n\n'+[
    '## Logistics\n<!-- preparation-section kind=logistics -->\nRoom\n\n',
    '## Custom card\n<!-- preparation-section kind=quiz -->\nKeep\n\n',
    '## CUSTOM CARD\n<!-- preparation-section kind=exercise appendix -->\nDuplicate\n\n',
    '## Unknown type\n<!-- preparation-section kind=seminar -->\nUnrecognized\n\n',
    '## Not logistics\n<!-- preparation-section kind=logistics -->\nWrong type\n\n',
    '## Old marker\n<!-- preparation-section -->\nOld notes\n\n',
    '## Other notes\n<!-- preparation-section kind=lecture -->\nTail\n## Logistics\nLiteral heading',
  ].join('');
  const doc = preparationDocument(body,outline);
  assert.deepEqual(doc.sections.map(s=>s.name),['Logistics','Custom card']);
  for (const text of ['Preamble','Duplicate','Unrecognized','Wrong type','Old notes','Tail','Literal heading']) assert.ok(doc.notes[OTHER_NOTES].includes(text));
  assert.deepEqual(preparationDocument(serializePreparationLayout(doc),{}),doc);
});

test('titles are single-line, bounded, case-insensitively unique, and never store display prefixes', () => {
  const sections = [{name:'Opening'},{name:'Appendix card',appendix:true}];
  assert.equal(cardTitle(' Renamed ',sections,'Opening'),'Renamed');
  assert.equal(cardTitle('opening',sections,'Opening'),'opening');
  assert.equal(cardTitle('🌐'.repeat(120),sections),'🌐'.repeat(120));
  for (const value of ['', ' ', 'x'.repeat(121), 'New\ncard', 'New\rcard', 'LOGISTICS', 'other notes', 'OPENING', 'appendix CARD', 'Lecture: Intro', 'In-Class Exercise: Memo'])
    assert.throws(()=>cardTitle(value,sections));
  const doc = preparationDocument('',outline);
  doc.sections.push({name:'__proto__',kind:'lecture'});
  doc.notes = {...doc.notes,['__proto__']:'Literal prototype name'};
  assert.equal(preparationDocument(serializePreparationLayout(doc),{}).notes.__proto__,'Literal prototype name');
});

test('layout moves preserve Logistics and group order; the whole-week body still has a size limit', () => {
  const doc = preparationDocument('',outline);
  assert.throws(()=>movePreparationCard(doc.sections,'Logistics',true),/stays first/);
  assert.throws(()=>movePreparationCard(doc.sections,'Evidence',false,'Missing'),/destination/);
  const moved = movePreparationCard(doc.sections,'Evidence',true);
  assert.equal(moved[0].name,'Logistics');
  assert.deepEqual(moved.filter(s=>s.appendix).map(s=>s.name),['Memo exercise','Evidence']);
  assert.ok(!doc.sections.find(s=>s.name==='Evidence').appendix);
  assert.throws(()=>noteValues(1,serializePreparationLayout({...doc,notes:{...doc.notes,Evidence:'x'.repeat(50000)}})),/50,000/);
  assert.throws(()=>serializePreparationLayout({...doc,sections:[...doc.sections,{name:'Invalid type',kind:'unknown'}]}),/Choose Lecture/);
});
