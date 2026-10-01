import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let db;
const ids = { instructor: '00000000-0000-0000-0000-000000000001', student: '00000000-0000-0000-0000-000000000002', observer: '00000000-0000-0000-0000-000000000003', unlisted: '00000000-0000-0000-0000-000000000004', outsider: '00000000-0000-0000-0000-000000000005', gsb: '00000000-0000-0000-0000-000000000006', password: '00000000-0000-0000-0000-000000000007' };
const emails = { instructor: 'oh@gsb.columbia.edu', student: 'ab1234@columbia.edu', observer: 'observer@columbia.edu', unlisted: 'zz9999@columbia.edu', outsider: 'outsider@gmail.com', gsb: 'demo@gsb.columbia.edu', password: 'cd5678@columbia.edu' };
async function as(role) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids[role], email: emails[role] })]);
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
}
async function rows(sql) { return (await db.query(sql)).rows; }
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth, storage, public to anon, authenticated;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
  `);
  for (const role of Object.keys(ids)) await db.query('insert into auth.users values ($1,$2,now(),$3)', [ids[role], emails[role], JSON.stringify({ provider: role === 'password' ? 'email' : 'google' })]);
  await db.exec(readFileSync(new URL('../supabase/migrations/001_course_materials.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.roster values ('ab1234', 'Demo'), ('cd5678', 'Other');
    insert into public.allowlist values ('observer@columbia.edu', 'observer');
    insert into public.assignments values (1,'Shared','Before Week 1',10,'D','D','G',true),(2,'Private','Before Week 2',10,'D','D','G',false);
    insert into public.lecture_files(id,week,title,storage_path,observer_visible) values ('11111111-0000-0000-0000-000000000001',1,'Shared PDF','week-1/shared.pdf',true),('11111111-0000-0000-0000-000000000002',1,'Private PDF','week-1/private.pdf',false);
    insert into storage.objects(bucket_id,name) values ('lecture-notes','week-1/shared.pdf'),('lecture-notes','week-1/private.pdf'),('lecture-notes','orphan.pdf');`);
});
after(async () => db?.close());
test('anonymous cannot read any private tables or storage objects', async () => {
  await as('anon');
  for (const table of ['profiles','roster','allowlist','assignments','lecture_files']) await assert.rejects(rows(`select * from public.${table}`), /permission denied/);
  assert.equal((await rows('select * from storage.objects')).length, 0);
  await assert.rejects(rows('select public.get_access()'), /permission denied/);
});
test('student reads content but cannot read roster, promote self, or upload files', async () => {
  await as('student'); assert.equal((await rows('select public.get_access() a'))[0].a.role, 'student');
  assert.equal((await rows('select * from public.assignments')).length, 2);
  assert.equal((await rows('select * from public.lecture_files')).length, 2);
  assert.equal((await rows('select * from public.roster')).length, 0);
  assert.equal((await rows('select * from public.allowlist')).length, 0);
  assert.equal((await rows('select * from storage.objects')).length, 0);
  await assert.rejects(db.exec("insert into public.allowlist values ('ab1234@columbia.edu','instructor_ta')"), /row-level security/);
  await assert.rejects(db.exec("update public.profiles set uni='cd5678'"), /permission denied/);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('lecture-notes','hacked.pdf')"), /row-level security/);
  assert.equal((await rows("update public.assignments set title='hacked' where id=1 returning *")).length, 0);
  await assert.rejects(rows(`select public.replace_roster('[{"uni":"hacked1"}]')`), /Instructor/);
});
test('observer sees only shared metadata and cannot bypass the signed-URL function', async () => {
  await as('observer'); assert.equal((await rows('select public.get_access() a'))[0].a.role, 'observer');
  assert.deepEqual((await rows('select title from public.assignments')).map(r => r.title), ['Shared']);
  assert.deepEqual((await rows('select title from public.lecture_files')).map(r => r.title), ['Shared PDF']);
  assert.equal((await rows('select name from storage.objects')).length, 0);
  assert.equal((await rows("delete from public.lecture_files returning *")).length, 0);
});
test('unlisted and non-Columbia users cannot obtain content', async () => {
  for (const role of ['unlisted','outsider','password']) {
    await as(role);
    for (const table of ['assignments','lecture_files','roster','allowlist']) assert.equal((await rows(`select * from public.${table}`)).length, 0, `${role} ${table}`);
    assert.equal((await rows('select * from storage.objects')).length, 0);
  }
  await as('outsider'); await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
  await as('password'); await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
});
test('GSB claim checks roster, saves once, and rejects later changes', async () => {
  await as('gsb'); const first = (await rows('select public.get_access() a'))[0].a;
  assert.equal(first.needs_uni, true); assert.equal(first.role, 'unlisted');
  await assert.rejects(rows("select public.claim_uni('zz9999')"), /not on the class list/);
  assert.equal((await rows("select public.claim_uni(' AB1234 ') a"))[0].a.role, 'student');
  await assert.rejects(rows("select public.claim_uni('cd5678')"), /already saved/);
});
test('instructor edits data but cannot delete or rename the owner allowlist entry', async () => {
  await as('instructor'); assert.equal((await rows('select public.get_access() a'))[0].a.role, 'instructor_ta');
  assert.equal((await rows('select * from public.roster')).length, 2);
  assert.equal((await rows("update public.assignments set title='Changed' where id=2 returning *")).length, 1);
  assert.equal((await rows("update public.lecture_files set observer_visible=true where title='Private PDF' returning *")).length, 1);
  assert.equal((await rows("delete from public.allowlist where email='oh@gsb.columbia.edu' returning *")).length, 0);
  assert.equal((await rows("update public.allowlist set email='other@columbia.edu' where email='oh@gsb.columbia.edu' returning *")).length, 0);
  await db.exec("insert into storage.objects(bucket_id,name) values ('lecture-notes','new.pdf')");
  assert.equal((await rows('select * from storage.objects')).length, 0);
  assert.equal((await rows("delete from storage.objects where name='new.pdf' returning *")).length, 0);
});
test('roster import is atomic and revokes students immediately', async () => {
  await as('instructor');
  await assert.rejects(rows('select public.replace_roster(null)'), /valid roster/);
  await assert.rejects(rows("select public.replace_roster('[]')"), /valid roster/);
  await assert.rejects(rows(`select public.replace_roster('[{"uni":"ab1234"},{"uni":"ab1234"}]')`), /duplicate/);
  assert.equal((await rows('select * from public.roster')).length, 2);
  await rows(`select public.replace_roster('[{"uni":"ef9876","name":"New Student"}]')`);
  await as('student'); assert.equal((await rows('select public.get_access() a'))[0].a.role, 'unlisted');
  assert.equal((await rows('select * from public.assignments')).length, 0);
  await as('gsb'); assert.equal((await rows('select public.get_access() a'))[0].a.role, 'unlisted');
});
test('forged JWT email and mutable user metadata do not grant access', async () => {
  await as('outsider'); await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids.outsider, email: 'oh@gsb.columbia.edu' })]);
  assert.equal((await rows('select * from public.assignments')).length, 0);
  await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
});

test('the private SQL seed imports all six assignments and preserves later edits', async context => {
  const seed = new URL('../supabase/private/seed.sql', import.meta.url);
  if (!existsSync(seed)) { context.skip('Private seed is not distributed with the public repository.'); return; }
  await db.exec('reset role; delete from public.assignments;');
  const sql = readFileSync(seed, 'utf8'); await db.exec(sql);
  const data = await rows('select id, points, observer_visible from public.assignments order by id');
  assert.deepEqual(data.map(r => r.id), [1,2,3,4,5,6]);
  assert.deepEqual(data.map(r => r.points), [10,10,10,10,10,25]);
  assert.ok(data.every(r => !r.observer_visible));
  await db.exec("update public.assignments set title='Instructor edit' where id=1");
  await db.exec(sql);
  assert.equal((await rows('select title from public.assignments where id=1'))[0].title, 'Instructor edit');
});
