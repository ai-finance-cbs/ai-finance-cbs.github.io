import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/lecture-file/handler.js';
const ID = '11111111-0000-0000-0000-000000000001';
function setup({ role = 'student', visible = true, valid = true, removeError = null, term = 'spring-2027', orphans = [], referenced = false, preview = false } = {}) {
  const calls = [];
  const query = {
    select() { return this; }, eq() { return this; },
    async single() { return visible ? { data: { id: ID, term_id: term, storage_path: 'week-1/server-path.pdf' } } : { error: { message: 'hidden' } }; },
    async maybeSingle() { return { data: referenced ? {id:ID} : null }; },
    delete() { calls.push('delete-metadata'); return { eq: async () => ({ error: null }) }; },
  };
  const caller = { auth: { getUser: async () => valid ? { data: { user: { id: 'authenticated' } } } : { error: {} } }, rpc: async name => ({ data: name==='lecture_orphans' ? orphans : { role, term_id: 'spring-2027', ...(preview?{view_as:{uni:'student'}}:{}) } }), from: () => query };
  const server = { storage: { from: bucket => {
    assert.equal(bucket, 'lecture-notes');
    return { createSignedUrl: async (path, ttl, opts) => { calls.push({ path, ttl, opts }); return { data: { signedUrl: 'https://storage.example/signed' } }; }, remove: async paths => { calls.push({ remove: paths }); return { error: removeError }; } };
  } } };
  const handler = createHandler((_url, key) => { if (key === 'server') { calls.push('server-client'); return server; } return caller; }, name => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'server' })[name]);
  const request = (body, headers = {}) => new Request('https://function.example/lecture-file', { method: 'POST', headers: { authorization: 'Bearer token', origin: 'https://ai-finance-cbs.github.io', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { handler, request, calls };
}
test('file function verifies identity and fixes expiry to 300 seconds', async () => {
  const { handler, request, calls } = setup();
  const response = await handler(request({ action: 'download', id: ID, expiresIn: 999999, path: 'evil.pdf' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).expiresIn, 300);
  assert.deepEqual(calls[1], { path: 'week-1/server-path.pdf', ttl: 300, opts: { download: true } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('denied identities, unlisted accounts, and hidden files never reach privileged storage', async () => {
  for (const [options, status] of [[{ valid: false },401],[{ role: 'unlisted' },403],[{ role: 'auditor', visible: false },404]]) {
    const { handler, request, calls } = setup(options); assert.equal((await handler(request({ action: 'download', id: ID }))).status, status); assert.deepEqual(calls, []);
  }
});
test('only instructors can delete files or clean failed uploads', async () => {
  const student = setup();
  for (const action of ['delete','cleanup','orphans']) assert.equal((await student.handler(student.request({ action, id: ID }))).status, 403);
  assert.deepEqual(student.calls, []);
  const instructor = setup({ role: 'instructor' });
  assert.equal((await instructor.handler(instructor.request({ action: 'delete', id: ID }))).status, 200);
  assert.deepEqual(instructor.calls, ['server-client', { remove: ['week-1/server-path.pdf'] }, 'delete-metadata']);
});
test('malformed requests and unapproved origins are rejected', async () => {
  const { handler, request, calls } = setup();
  assert.equal((await handler(request({ action: 'download', id: ID }, { authorization: '' }))).status, 401);
  assert.equal((await handler(request({ action: 'download', id: ID }, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handler(request({ action: 'download', id: '../private.pdf' }))).status, 400);
  assert.equal((await handler(request(null))).status, 400); assert.deepEqual(calls, []);
});
test('storage deletion failure leaves metadata intact for retry', async () => {
  const { handler, request, calls } = setup({ role: 'instructor', removeError: { message: 'temporary failure' } });
  assert.equal((await handler(request({ action: 'delete', id: ID }))).status, 502);
  assert.equal(calls.includes('delete-metadata'), false);
});

test('grader, auditor, unlisted, and student preview cannot mutate file storage',async()=>{
 for(const role of ['grader','auditor','unlisted','student'])for(const action of ['delete','cleanup','orphans']){
  const x=setup({role});assert.equal((await x.handler(x.request({action,id:ID,path:'week-1/'+ID+'.pdf'}))).status,403);assert.deepEqual(x.calls,[]);
 }
});

test('lecture cleanup accepts course paths and rejects unlisted legacy paths',async()=>{
  const x=setup({role:'instructor'});
  for(const week of [0,7])assert.equal((await x.handler(x.request({action:'cleanup',path:`week-${week}/${ID}.pdf`}))).status,200);
  assert.equal((await x.handler(x.request({action:'cleanup',path:`week-8/${ID}.pdf`}))).status,409);
  assert.deepEqual(x.calls.filter(c=>c.remove),[{remove:[`week-0/${ID}.pdf`]},{remove:[`week-7/${ID}.pdf`]}]);
});

test('instructor can download archived lecture files but cannot delete their objects',async()=>{
  const x=setup({role:'instructor',term:'spring-2026'});
  assert.equal((await x.handler(x.request({action:'delete',id:ID}))).status,403);
  assert.deepEqual(x.calls,[]);
  assert.equal((await x.handler(x.request({action:'download',id:ID}))).status,200);
});


test('orphan list uses caller authorization and cleanup rechecks references before privileged deletion',async()=>{
  const orphan={path:'legacy/old.pdf',size:27},x=setup({role:'instructor',orphans:[orphan]});
  assert.deepEqual(await (await x.handler(x.request({action:'orphans'}))).json(),{files:[orphan]});assert.deepEqual(x.calls,[]);
  assert.equal((await x.handler(x.request({action:'cleanup',path:orphan.path}))).status,200);assert.deepEqual(x.calls,['server-client',{remove:[orphan.path]}]);
  const referenced=setup({role:'instructor',orphans:[orphan],referenced:true});assert.equal((await referenced.handler(referenced.request({action:'cleanup',path:orphan.path}))).status,409);assert.deepEqual(referenced.calls,[]);
  const preview=setup({role:'instructor',preview:true});for(const action of ['orphans','cleanup'])assert.equal((await preview.handler(preview.request({action,path:orphan.path}))).status,403);assert.deepEqual(preview.calls,[]);
});
