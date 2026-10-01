import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { uploadStorageFile } from '../assets/materials/storage-upload.js';
let xhr;
const args = { url:'https://db.example/', key:'public-test-key', token:'student-test-token', path:'spring-2027/4/aa1001/file name.pdf', file:new File(['%PDF-1.7\n%%EOF'],'file name.pdf'), contentType:'application/pdf' };
beforeEach(() => {
  globalThis.XMLHttpRequest = class {
    constructor() { xhr=this; this.upload={}; this.headers={}; }
    open(method,url) { this.method=method; this.url=url; }
    setRequestHeader(key,value) { this.headers[key]=value; }
    send(body) { this.body=body; }
  };
});
test('XHR upload uses the caller token, canonical MIME, immutable POST path, and real byte progress', async () => {
  const progress=[], sent=uploadStorageFile({...args,onProgress:n=>progress.push(n)});
  assert.equal(xhr.method,'POST'); assert.equal(xhr.url,'https://db.example/storage/v1/object/submissions/spring-2027/4/aa1001/file%20name.pdf');
  assert.deepEqual(xhr.headers,{Authorization:'Bearer student-test-token',apikey:'public-test-key','Content-Type':'application/pdf','Cache-Control':'max-age=0','x-upsert':'false'});
  assert.equal(xhr.body,args.file); assert.equal(xhr.timeout,600000);
  for (const event of [{lengthComputable:true,loaded:24,total:100},{lengthComputable:false,loaded:45,total:0},{lengthComputable:true,loaded:62,total:100}]) xhr.upload.onprogress(event);
  assert.deepEqual(progress,[0,24,62]); xhr.status=200; xhr.onload(); await sent; assert.deepEqual(progress,[0,24,62,100]);
});
for (const [event,message] of [['onerror','Check your connection'],['ontimeout','timed out'],['onabort','cancelled']]) test(`XHR ${event} rejects without reporting completion`, async () => {
  const progress=[], sent=uploadStorageFile({...args,onProgress:n=>progress.push(n)});
  xhr[event](); await assert.rejects(sent,new RegExp(message)); assert.deepEqual(progress,[0]);
});
test('Storage JSON errors and non-JSON failures remain readable, and missing sessions send nothing', async () => {
  for (const [body,message] of [['{"message":"new row violates row-level security policy"}','row-level security'],['Bad gateway','Upload failed \\(502\\)']]) {
    const sent=uploadStorageFile(args); xhr.status=502; xhr.responseText=body; xhr.onload(); await assert.rejects(sent,new RegExp(message));
  }
  xhr=null; await assert.rejects(uploadStorageFile({...args,token:null}),/Sign in again/); assert.equal(xhr,null);
});
