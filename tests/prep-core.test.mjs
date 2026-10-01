import test from 'node:test';
import assert from 'node:assert/strict';
import { prepMarkdown, noteValues, speakerValues, sortedSpeakers } from '../assets/materials/prep-core.js';
import { pageAllowed } from '../assets/materials/class-core.js';

test('Preparation and Speakers allow only a real instructor', () => {
  for (const page of ['preparation','speakers']) {
    for (const role of ['instructor','grader','student','auditor','unlisted']) assert.equal(pageAllowed(page,{role}),role === 'instructor');
    assert.equal(pageAllowed(page,{role:'instructor',view_as:{uni:'ab1234'}}),false);
    assert.equal(pageAllowed(page,null),false);
  }
});
test('restricted Markdown escapes HTML and unsafe links, with only the requested elements', () => {
  const html = prepMarkdown('# Heading\n\n**Bold** and *italic* and __strong__ and _emphasis_\n\n- First\n- Second\n\n1. One\n2. Two\n\n[Web](https://example.test/?x=1&y=2) [Email](mailto:guest@example.test)\n<script>window.prepXss=1</script>\n<img src=x onerror=alert(1)>\n[bad](javascript:alert) [bad](data:text/html,hello) [bad](//example.test)');
  assert.match(html,/<h1>Heading<\/h1>/); assert.match(html,/<strong>Bold<\/strong>/); assert.match(html,/<em>italic<\/em>/);
  assert.match(html,/<ul>/); assert.match(html,/<ol>/); assert.match(html,/href="https:\/\/example.test\/\?x=1&amp;y=2"/);
  assert.match(html,/&lt;script&gt;/); assert.doesNotMatch(html,/<script|<img|href="(?:javascript|data|\/\/)/i);
  assert.ok([...html.matchAll(/<\/?([a-z0-9]+)/g)].every(m => ['h1','p','strong','em','ul','ol','li','a'].includes(m[1])));
  for (const payload of ['[bad](java\nscript:evil)','[bad](jav&#x61;script:evil)','[bad](https://test\"onmouseover=evil)','<svg/onload=evil>']) assert.doesNotMatch(prepMarkdown(payload),/<(?:svg|script)|href="(?:java|data)|onmouseover="/);
});
test('review payloads remain escaped as plain text inside paragraphs, bold text and headings', () => {
  for (const payload of ['[x](javascript:alert(1))','[x](https://a"onmouseover=...)','<img src=x onerror=alert(1)>']) {
    const escaped=payload.replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    assert.equal(prepMarkdown(payload),`<p>${escaped}</p>`);
    assert.equal(prepMarkdown(`**${payload}**`),`<p><strong>${escaped}</strong></p>`);
    for (const level of [1,2,6]) {
      assert.equal(prepMarkdown(`${'#'.repeat(level)} ${payload}`),`<h${level}>${escaped}</h${level}>`);
      assert.equal(prepMarkdown(`${'#'.repeat(level)} **${payload}**`),`<h${level}><strong>${escaped}</strong></h${level}>`);
    }
  }
});
test('speaker ordering follows workflow status then name, and filtering searches all fields', () => {
  const rows = [{id:'3',name:'Z',status:'Confirmed',notes:'Banking'},{id:'2',name:'Z',status:'Idea'},{id:'1',name:'A',status:'Idea'},{id:'4',name:'B',status:'Contacted'},{id:'5',name:'C',status:'Declined'}];
  assert.deepEqual(sortedSpeakers(rows).map(r => r.id),['1','2','4','3','5']);
  assert.deepEqual(sortedSpeakers(rows,' BANK ').map(r => r.id),['3']); assert.equal(rows[0].id,'3');
});
test('shared validation counts Unicode characters and bounds weeks and optional fields', () => {
  assert.equal(noteValues(1,'🌐'.repeat(50000)).body.length,100000);
  for (const args of [[0,''],[7,''],[1,'x'.repeat(50001)]]) assert.throws(() => noteValues(...args));
  const row = {name:' Name ',affiliation:'',topic:'',week:null,status:'Idea',contact:'',notes:''};
  assert.equal(speakerValues(row).name,'Name'); assert.equal(speakerValues(row).week,null);
  for (const change of [{name:''},{week:7},{status:'Pending'},{notes:'x'.repeat(10001)}]) assert.throws(() => speakerValues({...row,...change}));
});
