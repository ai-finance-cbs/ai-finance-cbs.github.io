import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/lecture-file/handler.js';
const ID = '11111111-0000-0000-0000-000000000001';
function setup({ role = 'student', visible = true, valid = true, removeError = null } = {}) {
  const calls = [];
  const query = {
    select() { return this; }, eq() { return this; },
    async single() { return visible ? { data: { id: ID, storage_path: 'week-1/server-path.pdf' } } : { error: { message: 'hidden' } }; },
    async maybeSingle() { return { data: null }; },
    delete() { calls.push('delete-metadata'); return { eq: async () => ({ error: null }) }; },
  };
  const caller = { auth: { getUser: async () => valid ? { data: { user: { id: 'authenticated' } } } : { error: {} } }, rpc: async () => ({ data: { role } }), from: () => query };
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
  for (const [options, status] of [[{ valid: false },401],[{ role: 'unlisted' },403],[{ role: 'observer', visible: false },404]]) {
    const { handler, request, calls } = setup(options); assert.equal((await handler(request({ action: 'download', id: ID }))).status, status); assert.deepEqual(calls, []);
  }
});
test('only instructors can delete files or clean failed uploads', async () => {
  const student = setup();
  for (const action of ['delete','cleanup']) assert.equal((await student.handler(student.request({ action, id: ID }))).status, 403);
  assert.deepEqual(student.calls, []);
  const instructor = setup({ role: 'instructor_ta' });
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
  const { handler, request, calls } = setup({ role: 'instructor_ta', removeError: { message: 'temporary failure' } });
  assert.equal((await handler(request({ action: 'delete', id: ID }))).status, 502);
  assert.equal(calls.includes('delete-metadata'), false);
});
