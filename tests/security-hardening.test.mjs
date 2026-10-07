import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { bootstrapSQL, migrationFiles, seedGoogleIdentity } from './helpers/database.mjs';
let db;
let inheritedAnon;
const people = {
  teacher: ['00000000-0000-0000-0000-000000000001', 'oh@gsb.columbia.edu'],
  student: ['00000000-0000-0000-0000-000000000002', 'ab1234@columbia.edu'],
  grader: ['00000000-0000-0000-0000-000000000003', 'grader@columbia.edu'],
  test: ['00000000-0000-0000-0000-000000000004', 'student@example.test'],
  auditor: ['00000000-0000-0000-0000-000000000005', 'auditor@columbia.edu'],
  unlisted: ['00000000-0000-0000-0000-000000000006', 'zz9999@columbia.edu'],
};
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
async function as(who, email = people[who]?.[1]) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(who === 'anon' ? {} : { sub: people[who][0], email }),
  ]);
  await db.exec(who === 'anon' ? 'set role anon' : 'set role authenticated');
}
async function rpc(name, ...args) {
  return (
    await rows(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args)
  )[0].value;
}
const attendance = async () => (await rpc('class_data')).attendance;
before(async () => {
  db = new PGlite();
  await db.exec(bootstrapSQL);
  for (const file of migrationFiles) {
    if (file === '004_security_hardening.sql')
      inheritedAnon = await rows(
        "select p.proname,has_function_privilege('anon',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_access','claim_uni','replace_roster') order by p.proname",
      );
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  }
  for (const [userId, email] of Object.values(people)) {
    await db.query('insert into auth.users values($1,$2,now(),\'{"provider":"google"}\')', [
      userId,
      email,
    ]);
    await seedGoogleIdentity(db, userId, email);
  }
  await db.exec(
    "insert into roster values('ab1234','Alice'); insert into allowlist values('grader@columbia.edu','grader'),('auditor@columbia.edu','auditor'),('newinstructor@columbia.edu','instructor'); delete from private.test_accounts; insert into private.test_accounts(email,role,uni) values('student@example.test','student','test1')",
  );
});
after(async () => db?.close());
beforeEach(async () => {
  await db.exec('reset role; begin');
});
afterEach(async () => {
  await db.exec('rollback; reset role');
});

async function denied(action, pattern) {
  // PostgreSQL aborts the transaction on a denied operation. Roll back only that attempt.
  await db.exec('savepoint forbidden_attempt');
  try {
    await assert.rejects(action, pattern);
  } finally {
    await db.exec('rollback to savepoint forbidden_attempt; release savepoint forbidden_attempt');
  }
}

test('Supabase default privileges reproduce the inherited anon EXECUTE gap and 004 closes it', async () => {
  assert.deepEqual(
    inheritedAnon.map((r) => r.proname),
    ['claim_uni', 'get_access', 'replace_roster'],
  );
  assert.ok(
    inheritedAnon.every((r) => r.allowed),
    'The pre-004 fixture must reproduce direct anon grants.',
  );
  await db.exec(
    'create function public.grant_probe() returns integer language sql as $$select 1$$; create table public.grant_probe_table(id integer)',
  );
  const grants = await rows(
    "select grantee::regrole::text role,privilege_type from pg_proc p cross join lateral aclexplode(p.proacl) where p.oid='public.grant_probe()'::regprocedure and grantee in ('anon'::regrole,'authenticated'::regrole)",
  );
  assert.deepEqual(grants.map((g) => g.role).sort(), ['anon', 'authenticated']);
  assert.ok(grants.every((g) => g.privilege_type === 'EXECUTE'));
  for (const role of ['anon', 'authenticated'])
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
      assert.equal(
        (
          await rows('select has_table_privilege($1,$2,$3) allowed', [
            role,
            'public.grant_probe_table',
            privilege,
          ])
        )[0].allowed,
        true,
      );
  await db.exec('drop function public.grant_probe(); drop table public.grant_probe_table');
  const functions = await rows(
    "select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
  );
  assert.equal(functions.length, 54);
  for (const name of ['save_task_map','my_task_map','task_map_class']) assert.ok(functions.some(f => f.proname === name));
  for (const f of functions) {
    assert.equal(
      (await rows("select has_function_privilege('anon',$1,'execute') allowed", [f.oid]))[0]
        .allowed,
      false,
      f.proname,
    );
    assert.equal(
      (
        await rows("select has_function_privilege('authenticated',$1,'execute') allowed", [f.oid])
      )[0].allowed,
      !['save_grades','grade_group','release_grade_item','replace_roster','begin_submission','finish_submission','submit_link','delete_submission','create_group_set','update_group_set','choose_group','set_group_note','add_groups','confirm_submission_upload','reject_submission_upload','submission_sweep_candidates','record_term_export','record_term_purge','calendar_data','begin_canvas_sync','publish_canvas_sync','fail_canvas_sync'].includes(f.proname),
      f.proname,
    );
  }
  await as('anon');
  for (const [fn, args] of [
    ['get_access', []],
    ['replace_roster', ['[{"uni":"ab1234"}]']],
  ])
    await denied(async () => rpc(fn, ...args), /permission denied/);
});

test('changing Auth email and JWT without a matching Google identity leaves the account unlisted', async () => {
  await db.query('update auth.users set email=$1 where id=$2', [
    'newinstructor@columbia.edu',
    people.student[0],
  ]);
  await as('student', 'newinstructor@columbia.edu');
  assert.equal((await rows('select private.current_role() role'))[0].role, 'unlisted');
  await denied(async () => rpc('get_access'), /verified Columbia/);
  await denied(async () => rpc('release_grade_item', 7, true), /Instructor|permission denied/);
  assert.deepEqual(await rows('select * from grades'), []);
  assert.deepEqual(await rows('select * from allowlist'), []);
});

test('unverified, missing, mismatched, and non-Google identities cannot grant access', async () => {
  for (const data of [
    { email: people.student[1], email_verified: false },
    { email: people.student[1] },
    { email: 'other@columbia.edu', email_verified: true },
  ]) {
    await db.exec('reset role');
    await db.query('update auth.identities set identity_data=$1 where user_id=$2', [
      JSON.stringify(data),
      people.student[0],
    ]);
    await as('student');
    assert.equal((await rows('select private.current_role() role'))[0].role, 'unlisted');
    await denied(async () => rpc('get_access'), /verified Columbia/);
  }
  await db.exec('reset role');
  await db.query("update auth.identities set provider='email',identity_data=$1 where user_id=$2", [
    JSON.stringify({ email: people.student[1], email_verified: true }),
    people.student[0],
  ]);
  await as('student');
  assert.equal((await rows('select private.current_role() role'))[0].role, 'unlisted');
  await db.exec('reset role');
  await db.query('delete from auth.identities where user_id=$1', [people.student[0]]);
  await as('student');
  assert.equal((await rows('select private.current_role() role'))[0].role, 'unlisted');
});

test('verified Google identities match case-insensitively and cannot be edited by the caller', async () => {
  await db.query('update auth.identities set identity_data=$1 where user_id=$2', [
    JSON.stringify({ email: 'AB1234@COLUMBIA.EDU', email_verified: true }),
    people.student[0],
  ]);
  await as('student');
  assert.equal((await rpc('get_access')).role, 'student');
  await denied(
    async () =>
      db.query('update auth.identities set identity_data=$1', [
        JSON.stringify({ email: 'newinstructor@columbia.edu', email_verified: true }),
      ]),
    /permission denied/,
  );
});

test('private test accounts do not bypass Google identity verification', async () => {
  await as('test');
  assert.equal((await rpc('get_access')).uni, 'test1');
  await db.exec('reset role');
  await db.query(
    "update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where user_id=$1",
    [people.test[0]],
  );
  await as('test');
  assert.equal((await rows('select private.current_role() role'))[0].role, 'unlisted');
  await denied(async () => rpc('get_access'), /verified Columbia/);
});

test('student attendance reveals no quiz provenance before release, including raw filters and preview', async () => {
  await as('teacher');
  const manual = [{ uni: 'ab1234', week: 1, status: 'present', source_quiz: null, manual_override: null }];
  await db.exec("reset role; insert into grades(uni,item_id,score) values('ab1234',7,0); insert into attendance(uni,week,status,source_quiz) values('ab1234',1,'present',1)");
  await as('grader');
  assert.equal((await attendance())[0].source_quiz, 1);
  assert.equal((await attendance())[0].manual_override, false);
  await as('student');
  assert.deepEqual(await attendance(), manual);
  assert.deepEqual((await rpc('class_data')).grades, []);
  assert.deepEqual(await rows('select source_quiz,manual_override from attendance'), []);
  assert.equal(
    Number(
      (
        await rows('select count(*) n from attendance where source_quiz=1 or not manual_override')
      )[0].n,
    ),
    0,
  );
  await as('teacher');
  await rpc('set_student_preview', 'ab1234');
  assert.deepEqual((await rpc('view_as_student', 'ab1234')).attendance, manual);
  assert.deepEqual(await rows('select * from attendance'), []);
  await rpc('set_student_preview', null);
  await db.exec('reset role; update grade_items set released=true where id=7');
  await as('student');
  assert.deepEqual(await attendance(), [
    { uni: 'ab1234', week: 1, status: 'present', source_quiz: 1, manual_override: false },
  ]);
  assert.equal((await rpc('class_data')).grades[0].score, 0);
  await as('teacher');
  await db.exec("reset role; delete from grades where item_id=7; delete from attendance where week=1");await as('teacher');
  await rpc('save_attendance', 1, '[{"uni":"ab1234","status":"excused","excuse_reason":"Approved absence"}]');
  await db.exec('reset role; update grade_items set released=false where id=7');
  await as('student');
  assert.deepEqual(await attendance(), [
    { uni: 'ab1234', week: 1, status: 'excused', source_quiz: null, manual_override: null },
  ]);
});

test('claim_uni is removed for every role', async () => {
  assert.equal((await rows("select to_regprocedure('public.claim_uni(text)') fn"))[0].fn, null);
  for (const who of [...Object.keys(people), 'anon']) {
    await as(who);
    await denied(() => rpc('claim_uni', 'ab1234'), /does not exist/);
  }
});
