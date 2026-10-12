import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGroupLink,groupLinkHint,groupLinkClosed} from '../assets/materials/group-link-core.js';
test('https links support custom domains and query strings, with a 2000-character cap',()=>{
  for(const link of ['https://team.github.io/site/','https://example.test/path?q=1#section','https://例え.jp/','HTTPS://EXAMPLE.TEST'])assert.equal(validateGroupLink(` ${link} `),link);
  const exact='https://example.test/'+ 'a'.repeat(1979);assert.equal(exact.length,2000);assert.equal(validateGroupLink(exact),exact);
  for(const value of ['',null,{},'http://example.test','javascript:alert(1)','//example.test','https://','https:///bad','https://[','https://example.test/a b','https://example.test/\n','https://example.test\\@bad.test',exact+'a']) {
    // Surrounding whitespace is removed; embedded whitespace is not.
    if(value==='https://example.test/\n')assert.equal(validateGroupLink(value),'https://example.test/');else assert.throws(()=>validateGroupLink(value));
  }
});
test('the github.io hint uses the hostname, never a path or substring, and does not block custom sites',()=>{
  for(const value of ['https://team.github.io/','https://TEAM.GITHUB.IO/path','https://github.io/',''])assert.equal(groupLinkHint(value),'');
  for(const value of ['https://example.test','https://github.io.example.test','https://example.test/github.io','https://github.io@evil.test'])assert.match(groupLinkHint(value),/custom domain is fine/);
});
test('deadlines close at the boundary and fail closed on missing or invalid dates',()=>{
  const due='2027-03-01T14:00:00Z',at=Date.parse(due);
  assert.equal(groupLinkClosed(due,at-1),false);assert.equal(groupLinkClosed(due,at),true);assert.equal(groupLinkClosed(due,at+1),true);
  for(const value of [null,undefined,'','not a date'])assert.equal(groupLinkClosed(value,at),true);
});
