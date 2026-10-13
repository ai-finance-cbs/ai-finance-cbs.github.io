import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Use the same YAML reader as Jekyll; this needs no extra dependency.
const { library, materials } = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e',
  'puts %w[library materials].to_h { |name| [name, YAML.load_file("_data/#{name}.yml")] }.to_json'],
{ cwd: new URL('../', import.meta.url), encoding: 'utf8' }));
const allTopics = page => [...page.topics, ...(page.sections || []).flatMap(section => section.topics)];

test('every Library item has a declared topic, author, year, and public link', () => {
  const seen = new Set();
  for (const item of materials) {
    assert.ok(library.some(section => section.week === item.week && allTopics(section).includes(item.topic)), item.title);
    assert.ok(item.author?.trim(), item.title);
    assert.ok(Number.isInteger(item.year) || item.year === 'n.d.', item.title);
    assert.ok(['required', 'recommended', 'optional'].includes(item.level), item.title);
    assert.ok(['Writing', 'Video', 'Podcast'].includes(item.kind), item.title);
    assert.ok(['http:', 'https:'].includes(new URL(item.url).protocol), item.title);
    const key = `${item.week}|${item.topic}|${item.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}`;
    assert.ok(!seen.has(key), `Duplicate item in one topic: ${item.title}`);
    seen.add(key);
  }
});

test('built Library pages include every catalog row and keep optional items oldest first', () => {
  for (const section of library) {
    const html = readFileSync(new URL(`../_site/library/${section.slug}/index.html`, import.meta.url), 'utf8');
    const blocks = [...html.matchAll(/<section class="topic-block"[\s\S]*?<\/section>/g)].map(match => match[0]);
    assert.equal(blocks.length, allTopics(section).length, section.slug);
    for (const [index, topic] of allTopics(section).entries()) {
      const expected = materials.filter(item => item.week === section.week && item.topic === topic);
      const rows = [...blocks[index].matchAll(/<li class="material" data-level="([^"]+)"[\s\S]*?<\/li>/g)];
      assert.equal(rows.length, expected.length, `${section.slug}: ${topic}`);
      for (const item of expected) {
        assert.ok(rows.some(row => row[0].includes(`href="${item.url}"`) && row[0].includes(`>${item.title}</a>`)), item.title);
      }
      const optionalTitles = rows.filter(row => row[1] === 'optional').map(row => row[0].match(/<a [^>]*>([\s\S]*?)<\/a>/)[1]);
      // Equal-year ties have no promised order in Liquid. Only chronology is required.
      const years = optionalTitles.map(title => String(expected.find(item => item.title === title).year));
      assert.deepEqual(years, [...years].sort(), `${section.slug}: ${topic}`);
    }
  }
});

test('economics Research contains only new entries across four source groups', () => {
  const economics = library.find(page => page.slug === 'economics-of-ai');
  assert.deepEqual(economics.topics, ['Economic Frameworks for AI', 'Bulls vs. Skeptics', 'Nature of Financial Work']);
  const groups = ['Macro Implications', 'Labor Markets', 'Financial Sector', 'Alignment and Governance'];
  assert.deepEqual(economics.sections, [{ title: 'Research', topics: groups }]);
  for (const [index, topic] of groups.entries()) {
    const papers = materials.filter(item => item.week === 1 && item.topic === topic);
    assert.equal(papers.length, [6, 21, 10, 3][index], topic);
    for (const paper of papers) {
      assert.equal(materials.filter(item => item.title === paper.title).length, 1, paper.title);
      assert.equal(paper.level, 'optional', paper.title);
    }
  }
  // The full reading list must still render everything it counts, including Research.
  const week = readFileSync(new URL('../_site/materials/week-1/index.html', import.meta.url), 'utf8');
  const readings = week.match(/<template data-week-readings>([\s\S]*?)<\/template>/)[1];
  assert.equal([...readings.matchAll(/<li class="material"/g)].length, materials.filter(item => item.week === 1).length);
  for (const page of library.filter(page => page.week !== 1)) {
    assert.equal(page.sections, undefined);
    const html = readFileSync(new URL(`../_site/library/${page.slug}/index.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /class="library-group"/);
    assert.equal([...html.matchAll(/<h2 id="topic-/g)].length, page.topics.length, page.slug);
  }
});

test('pre-existing resources keep their original syllabus locations, including repeated readings', () => {
  // Amendment 2 preserves these student reading assignments instead of moving them into Research or Prelude.
  const originals = [
    ['The Simple Macroeconomics of AI', [[99, 'AI and the Wider Economy', 'paper']]],
    ['A.I. and Our Economic Future', [[1, 'Economic Frameworks for AI', undefined]]],
    ['Will AI Soon Lead to Double-Digit Growth?', [[1, 'Bulls vs. Skeptics', '30 min']]],
    ['Generative AI at Work', [[99, 'AI and the Wider Economy', 'paper']]],
    ['Navigating the Jagged Technological Frontier', [[5, 'Defending the Analysis', 'paper']]],
    ['From Man vs. Machine to Man + Machine: The Art and AI of Stock Analyses', [[4, 'Predicting Fundamentals', 'paper']]],
    ['The Law of Leaky Abstractions', [[2, 'Data and Context', '10 min']]],
    ['Google: We Have No Moat, And Neither Does OpenAI', [[1, 'Economic Frameworks for AI', '12 min']]],
    ['Machines of Loving Grace', [[1, 'Bulls vs. Skeptics', '1 hr'], [99, 'What the AI Labs Believe', '60 min']]],
    ['Situational Awareness: The Decade Ahead', [[1, 'Bulls vs. Skeptics', undefined], [99, 'Predictions and Scenarios', 'long essay']]],
  ];
  for (const [title, locations] of originals) {
    assert.deepEqual(materials.filter(item => item.title === title).map(item => [item.week, item.topic, item.length]), locations, title);
  }
});
