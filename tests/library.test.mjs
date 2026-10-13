import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Use the same YAML reader as Jekyll; this needs no extra dependency.
const { library, materials } = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e',
  'puts %w[library materials].to_h { |name| [name, YAML.load_file("_data/#{name}.yml")] }.to_json'],
{ cwd: new URL('../', import.meta.url), encoding: 'utf8' }));

test('every Library item has a declared topic, author, year, and public link', () => {
  const seen = new Set();
  for (const item of materials) {
    assert.ok(library.some(section => section.week === item.week && section.topics.includes(item.topic)), item.title);
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
    assert.equal(blocks.length, section.topics.length, section.slug);
    for (const [index, topic] of section.topics.entries()) {
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
