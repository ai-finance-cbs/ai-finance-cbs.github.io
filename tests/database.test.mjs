import { bootstrapSQL, migrationFiles, seedGoogleIdentity } from './helpers/database.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let db;
const ids = {
  instructor: '00000000-0000-0000-0000-000000000001',
  student: '00000000-0000-0000-0000-000000000002',
  auditor: '00000000-0000-0000-0000-000000000003',
  unlisted: '00000000-0000-0000-0000-000000000004',
  outsider: '00000000-0000-0000-0000-000000000005',
  gsb: '00000000-0000-0000-0000-000000000006',
  password: '00000000-0000-0000-0000-000000000007',
};
const emails = {
  instructor: 'oh@gsb.columbia.edu',
  student: 'ab1234@columbia.edu',
  auditor: 'auditor@columbia.edu',
  unlisted: 'zz9999@columbia.edu',
  outsider: 'outsider@gmail.com',
  gsb: 'demo@gsb.columbia.edu',
  password: 'cd5678@columbia.edu',
};
async function as(role) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: ids[role], email: emails[role] }),
  ]);
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
}
async function rows(sql) {
  return (await db.query(sql)).rows;
}
before(async () => {
  db = new PGlite();
  await db.exec(bootstrapSQL);
  for (const role of Object.keys(ids)) {
    await db.query('insert into auth.users values ($1,$2,now(),$3)', [
      ids[role],
      emails[role],
      JSON.stringify({ provider: role === 'password' ? 'email' : 'google' }),
    ]);
    if (role !== 'password') await seedGoogleIdentity(db, ids[role], emails[role]);
  }
  for (const file of migrationFiles)
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  await db.exec(`insert into public.roster values ('ab1234', 'Demo'), ('cd5678', 'Other');
    insert into public.allowlist values ('auditor@columbia.edu', 'auditor');
    insert into public.assignments values (1,'Shared','Before Week 1',10,'D','D','G',true),(2,'Private','Before Week 2',10,'D','D','G',false);
    insert into public.lecture_files(id,week,title,storage_path,auditor_visible) values ('11111111-0000-0000-0000-000000000001',1,'Shared PDF','week-1/shared.pdf',true),('11111111-0000-0000-0000-000000000002',1,'Private PDF','week-1/private.pdf',false);
    insert into storage.objects(bucket_id,name) values ('lecture-notes','week-1/shared.pdf'),('lecture-notes','week-1/private.pdf'),('lecture-notes','orphan.pdf');`);
});
after(async () => db?.close());
test('anonymous cannot read any private tables or storage objects', async () => {
  await as('anon');
  for (const table of ['profiles', 'roster', 'allowlist', 'assignments', 'lecture_files'])
    await assert.rejects(rows(`select * from public.${table}`), /permission denied/);
  assert.equal((await rows('select * from storage.objects')).length, 0);
  await assert.rejects(rows('select public.get_access()'), /permission denied/);
});
test('student reads content but cannot read roster, promote self, or upload files', async () => {
  await as('student');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'student');
  assert.equal((await rows('select * from public.assignments')).length, 2);
  assert.equal((await rows('select * from public.lecture_files')).length, 2);
  assert.equal((await rows('select * from public.roster')).length, 0);
  assert.equal((await rows('select * from public.allowlist')).length, 0);
  assert.equal((await rows('select * from storage.objects')).length, 0);
  await assert.rejects(
    db.exec("insert into public.allowlist values ('ab1234@columbia.edu','instructor')"),
    /row-level security/,
  );
  await assert.rejects(db.exec("update public.profiles set uni='cd5678'"), /permission denied/);
  await assert.rejects(
    db.exec("insert into storage.objects(bucket_id,name) values ('lecture-notes','hacked.pdf')"),
    /row-level security/,
  );
  assert.equal(
    (await rows("update public.assignments set title='hacked' where id=1 returning *")).length,
    0,
  );
  await assert.rejects(rows(`select public.replace_roster('[{"uni":"hacked1"}]')`), /Instructor/);
});
test('auditor sees only shared metadata and cannot bypass the signed-URL function', async () => {
  await as('auditor');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'auditor');
  assert.deepEqual(
    (await rows('select title from public.assignments')).map((r) => r.title),
    ['Shared'],
  );
  assert.deepEqual(
    (await rows('select title from public.lecture_files')).map((r) => r.title),
    ['Shared PDF'],
  );
  assert.equal((await rows('select name from storage.objects')).length, 0);
  assert.equal((await rows('delete from public.lecture_files returning *')).length, 0);
});
test('unlisted and non-Columbia users cannot obtain content', async () => {
  for (const role of ['unlisted', 'outsider', 'password']) {
    await as(role);
    for (const table of ['assignments', 'lecture_files', 'roster', 'allowlist'])
      assert.equal((await rows(`select * from public.${table}`)).length, 0, `${role} ${table}`);
    assert.equal((await rows('select * from storage.objects')).length, 0);
  }
  await as('outsider');
  await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
  await as('password');
  await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
});
test('GSB accounts use instructor-approved links and cannot self-claim', async () => {
  await as('gsb');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'unlisted');
  await assert.rejects(rows("select public.claim_uni('ab1234')"), /does not exist/);
  await as('instructor');
  await db.query('select public.link_student_account($1,$2)', [emails.gsb, 'ab1234']);
  await as('gsb');
  const access = (await rows('select public.get_access() a'))[0].a;
  assert.equal(access.role, 'student');
  assert.equal(access.uni, 'ab1234');
});
test('instructor edits data but cannot delete or rename the owner allowlist entry', async () => {
  await as('instructor');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'instructor');
  assert.equal((await rows('select * from public.roster')).length, 2);
  assert.equal(
    (await rows("update public.assignments set title='Changed' where id=2 returning *")).length,
    1,
  );
  assert.equal(
    (
      await rows(
        "update public.lecture_files set auditor_visible=true where title='Private PDF' returning *",
      )
    ).length,
    1,
  );
  assert.equal(
    (await rows("delete from public.allowlist where email='oh@gsb.columbia.edu' returning *"))
      .length,
    0,
  );
  assert.equal(
    (
      await rows(
        "update public.allowlist set email='other@columbia.edu' where email='oh@gsb.columbia.edu' returning *",
      )
    ).length,
    0,
  );
  await db.exec("insert into storage.objects(bucket_id,name) values ('lecture-notes','new.pdf')");
  assert.equal((await rows('select * from storage.objects')).length, 0);
  assert.equal(
    (await rows("delete from storage.objects where name='new.pdf' returning *")).length,
    0,
  );
});
test('roster import is atomic and revokes students immediately', async () => {
  await as('instructor');
  await assert.rejects(rows('select public.replace_roster(null)'), /valid roster/);
  await assert.rejects(rows("select public.replace_roster('[]')"), /valid roster/);
  await assert.rejects(
    rows(`select public.replace_roster('[{"uni":"ab1234"},{"uni":"ab1234"}]')`),
    /duplicate/,
  );
  assert.equal((await rows('select * from public.roster')).length, 2);
  await rows(`select public.replace_roster('[{"uni":"ef9876","name":"New Student"}]')`);
  await as('student');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'unlisted');
  assert.equal((await rows('select * from public.assignments')).length, 0);
  await as('gsb');
  assert.equal((await rows('select public.get_access() a'))[0].a.role, 'unlisted');
});
test('forged JWT email and mutable user metadata do not grant access', async () => {
  await as('outsider');
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: ids.outsider, email: 'oh@gsb.columbia.edu' }),
  ]);
  assert.equal((await rows('select * from public.assignments')).length, 0);
  await assert.rejects(rows('select public.get_access()'), /verified Columbia/);
});

test('legacy private assignment seed imports before migration 003 and preserves later edits', async (context) => {
  const seed = new URL('../supabase/private/seed.sql', import.meta.url);
  if (!existsSync(seed)) {
    context.skip('Private seed is not distributed with the public repository.');
    return;
  }
  const seedDb = new PGlite();
  try {
    await seedDb.exec(bootstrapSQL);
    await seedDb.exec(
      readFileSync(
        new URL('../supabase/migrations/001_course_materials.sql', import.meta.url),
        'utf8',
      ),
    );
    const sql = readFileSync(seed, 'utf8');
    await seedDb.exec(sql);
    const data = (
      await seedDb.query('select id,points,observer_visible from public.assignments order by id')
    ).rows;
    assert.deepEqual(
      data.map((r) => r.id),
      [1, 2, 3, 4, 5, 6],
    );
    assert.deepEqual(
      data.map((r) => r.points),
      [10, 10, 10, 10, 10, 25],
    );
    assert.ok(data.every((r) => !r.observer_visible));
    await seedDb.exec("update public.assignments set title='Instructor edit' where id=1");
    await seedDb.exec(sql);
    assert.equal(
      (await seedDb.query('select title from public.assignments where id=1')).rows[0].title,
      'Instructor edit',
    );
  } finally {
    await seedDb.close();
  }
});
