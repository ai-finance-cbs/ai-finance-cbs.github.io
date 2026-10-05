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
  goal:week.goal, exercises:week.exercises, milestone:week.milestone,
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
    assert.deepEqual(sections.map(s => s.name),['Introduction',...expected.topics.map(t => t.name),'Quiz (3 questions)',...expected.exercises,'Milestone','Logistics','Other notes']);
    assert.deepEqual(sections.filter(s => s.exercise).map(s => s.name),expected.exercises);
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
