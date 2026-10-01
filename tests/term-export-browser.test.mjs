import test from 'node:test';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';
import {exportTermArchive} from '../assets/materials/term-export.js';
const plan=()=>({csv:'UNI,M1\naa1001,0',metadata:{missing_files:[{name:'missing.pdf',path:'missing',bucket:'submissions'}]},files:[{name:'submissions/work.pdf',path:'saved',url:'https://signed.example/work?secret=token',size:4}],ticket:{payload:'private',signature:'private'},file_count:1,byte_count:4});
test('browser writes a valid ZIP with missing metadata before recording actual file counts',async()=>{
  let saved=false;const m=plan(),calls=[];
  await exportTermArchive('spring-2027',async body=>{calls.push(body);if(body.action==='export')return m;assert.ok(saved);},{loadZip:async()=>fflate,fetchFile:async()=>new Response('work'),saveArchive:async(blob,name)=>{
    assert.equal(name,'spring-2027.zip');const entries=fflate.unzipSync(new Uint8Array(await blob.arrayBuffer()));
    assert.deepEqual(Object.keys(entries),['grades.csv','manifest.json','submissions/work.pdf']);assert.equal(fflate.strFromU8(entries['submissions/work.pdf']),'work');
    assert.deepEqual(JSON.parse(fflate.strFromU8(entries['manifest.json'])).missing_files,m.metadata.missing_files);
    assert.doesNotMatch(fflate.strFromU8(entries['manifest.json']),/secret=|signature|ticket/);saved=true;
  }});
  assert.equal(calls.at(-1).file_count,1);assert.equal(calls.at(-1).byte_count,4);
});
test('network, wrong-size, ZIP, and save failures never record an export',async()=>{
  for(const options of [{fetchFile:async()=>new Response('',{status:500})},{fetchFile:async()=>new Response('short')},{loadZip:async()=>{throw new Error('library failed');}},{saveArchive:async()=>{throw new Error('save failed');}}]) {
    const calls=[];await assert.rejects(exportTermArchive('spring-2027',async body=>{calls.push(body);return plan();},{loadZip:async()=>fflate,fetchFile:async()=>new Response('work'),saveArchive:async()=>{},...options}));
    assert.ok(!calls.some(c=>c.action==='record'));
  }
});
test('expired URLs refresh; a newly missing object is omitted and listed without blocking the ZIP',async()=>{
  for(const missing of [false,true]) {
    let prepares=0,fetches=0;const calls=[];
    await exportTermArchive('spring-2027',async body=>{
      calls.push(body);if(body.action==='record')return;
      const m=plan();if(++prepares>1){if(missing){m.metadata.missing_files.push(m.files[0]);m.files=[];m.file_count=0;m.byte_count=0;}else m.files[0].url='https://signed.example/fresh';}return m;
    },{loadZip:async()=>fflate,fetchFile:async()=>++fetches===1?new Response('',{status:missing?404:403}):new Response('work'),saveArchive:async()=>{}});
    assert.equal(prepares,2);assert.equal(calls.at(-1).file_count,missing?0:1);assert.equal(calls.at(-1).missing_files.length,missing?2:1);
  }
});
