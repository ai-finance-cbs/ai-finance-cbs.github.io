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
  for (const page of ['week-1', 'week-2', 'week-3', 'week-4', 'week-5', 'week-6', 'grades', 'attendance', 'groups', 'gradebook', 'roster', 'settings', 'submit', 'preparation', ...Array.from({length:6},(_,i)=>`preparation/week-${i+1}`), 'speakers']) {
    const html = readFileSync(new URL(`materials/${page}/index.html`, output), 'utf8');
    assert.match(html, /Sign in to see course materials/);
    assert.doesNotMatch(html, /<section class="assignment-section"/);
  }
});
test('every legacy address redirects and no active page links to Schedule or retired materials tabs', () => {
  for (const slug of ['', ...Array.from({length:6},(_,i)=>`week-${i+1}/`)]) {
    const html=readFileSync(new URL(`schedule/${slug}index.html`,output),'utf8');
    assert.match(html,new RegExp(`/syllabus/${slug}`)); assert.match(html,/location.replace/);
  }
  for(const slug of ['upcoming','assignments','lecture-notes','files']) {
    const html=readFileSync(new URL(`materials/${slug}/index.html`,output),'utf8');
    assert.match(html,/location.replace/); assert.match(html,/\/materials\//);
  }
  for(const file of walk(output.pathname).filter(f=>f.endsWith('.html') && !/\/schedule\//.test(f) && !/\/materials\/(upcoming|assignments|lecture-notes)\//.test(f))) {
    const html=readFileSync(file,'utf8');
    assert.doesNotMatch(html, /(?:href|xlink_url)=["'][^"']*\/(?:schedule\/|materials\/(?:upcoming|assignments|lecture-notes)\/)/,file);
  }
});
test('week reading templates use each week’s Library data', () => {
  for(const [week,title,slug] of [[1,'Our AI Future: From Abundance to Apocalypse','economics-of-ai'],[2,'DeepSeek FAQ','ai-infrastructure'],[3,'Using EDGAR to Research Investments','processing-information'],[4,'Lies, Damned Lies, and Data Mining','predicting-outcomes'],[5,'PowerPoint Is Evil','persuading-stakeholders'],[6,'Apps, Agents, and Aggregation','future-of-finance']]) {
    const html=readFileSync(new URL(`materials/week-${week}/index.html`,output),'utf8');
    assert.ok(html.includes(title)); assert.ok(html.includes(`/library/${slug}/`));
  }
});


test('instructor pages contain only gates; private prep and speaker canaries never enter public assets', () => {
  const pages = ['preparation',...Array.from({length:6},(_,i)=>`preparation/week-${i+1}`),'speakers'];
  for (const page of pages) {
    const html=readFileSync(new URL(`materials/${page}/index.html`,output),'utf8');
    const gate=html.match(/<div id="materials-root"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(gate); assert.match(gate,/Sign in to see course materials/);
    assert.doesNotMatch(gate,/<(?:textarea|input|section|form)\b|Demo preparation|Alex Example/);
  }
  // These records live only in the local database fixture, outside the published tree.
  for (const file of walk(output.pathname).filter(f=>/\.(html|js|json)$/.test(f))) {
    const text=readFileSync(file,'utf8');
    for (const secret of ['Private preparation canary e4c159','Private guest canary 9ad682','Private speaker notes canary 85ac17']) assert.ok(!text.includes(secret),file);
  }
  const publishedJS=walk(output.pathname).filter(f=>f.endsWith('.js') && !f.endsWith('/prep-demo.js'));
  for (const file of publishedJS) assert.doesNotMatch(readFileSync(file,'utf8'),/Alex Example|Jordan Sample|Taylor Demo/);
});
