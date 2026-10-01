import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const output = new URL('../_site/', import.meta.url);
function walk(path) { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)]); }
test('static build excludes migrations, private seeds, tests, credentials, and setup files', () => {
  assert.ok(existsSync(output), 'Run npm run build first.');
  for (const path of ['supabase', 'tests', 'node_modules', '__archive__', 'SETUP.md', 'NOTES.md', '.env.example', 'package.json', 'package-lock.json', 'playwright.config.mjs']) assert.equal(existsSync(new URL(path, output)), false, path);
});
test('private assignment descriptions never enter generated HTML or JS', context => {
  const seed = new URL('../supabase/private/seed.sql', import.meta.url);
  if (!existsSync(seed)) { context.skip('The private seed is deliberately absent from public clones.'); return; }
  // Read private strings locally; do not copy course text into a public test fixture.
  const forbidden = [...readFileSync(seed, 'utf8').matchAll(/'((?:[^']|'')*)'/g)]
    .map(match => match[1].replaceAll("''", "'"))
    .filter(text => text.length > 60);
  assert.ok(forbidden.length >= 6);
  for (const file of walk(output.pathname).filter(f => /\.(html|js|json|sql|md|yml)$/.test(f))) {
    const text = readFileSync(file, 'utf8'); for (const phrase of forbidden) assert.equal(text.includes(phrase), false, file);
  }
});
test('material page source contains gates and no real assignment content', () => {
  for (const page of ['upcoming', 'assignments', 'lecture-notes', 'attendance', 'groups', 'gradebook', 'roster', 'files', 'settings']) {
    const html = readFileSync(new URL(`materials/${page}/index.html`, output), 'utf8');
    assert.match(html, /Sign in to see course materials/);
    assert.doesNotMatch(html, /<section class="assignment-section"/);
  }
});
