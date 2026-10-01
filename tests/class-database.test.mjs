import { bootstrapSQL } from './helpers/database.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
let db;
const people = [
  ['teacher', 'oh@gsb.columbia.edu'],
  ['a', 'ab1234@columbia.edu'],
  ['b', 'cd5678@columbia.edu'],
  ['auditor', 'auditor@columbia.edu'],
  ['unlisted', 'zz9999@columbia.edu'],
  ['test', 'simonsm.oh@gmail.com'],
  ['grader', 'grader@columbia.edu'],
  ['gsb', 'alias@gsb.columbia.edu'],
];
const id = (role) =>
  `00000000-0000-0000-0000-00000000000${people.findIndex((p) => p[0] === role) + 1}`;
async function as(role) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id(role), email: people.find((p) => p[0] === role)[1] }),
  ]);
  await db.exec('set role authenticated');
}
async function rpc(name, ...args) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`,
      args,
    )
  ).rows[0].value;
}
const rows = async (sql) => (await db.query(sql)).rows;
before(async () => {
  db = new PGlite();
  await db.exec(bootstrapSQL);
  for (const [role, email] of people)
    await db.query('insert into auth.users values($1,$2,now(),$3)', [
      id(role),
      email,
      JSON.stringify({ provider: 'google' }),
    ]);
  for (const file of ['001_course_materials.sql', '002_test_accounts.sql', '003_class_tools.sql']) {
    if (file === '003_class_tools.sql')
      await db.exec(
        "insert into allowlist values('legacyteacher@columbia.edu','instructor_ta'),('legacyauditor@columbia.edu','observer'); insert into assignments values(6,'Legacy','Week 6',25,'Existing content','Existing work','Criteria',true)",
      );
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  }
  await db.exec(
    `insert into public.roster values('ab1234','Alice'),('cd5678','Bob'); insert into public.allowlist values('auditor@columbia.edu','auditor'),('grader@columbia.edu','grader');`,
  );
});
after(async () => db?.close());
test('migration preserves legacy roles/visibility and seeds six sessions and sixteen grading items', async () => {
  await as('teacher');
  const d = await rpc('class_data');
  assert.equal(
    (await rows("select role from allowlist where email='legacyteacher@columbia.edu'"))[0].role,
    'instructor',
  );
  assert.equal(
    (await rows("select role from allowlist where email='legacyauditor@columbia.edu'"))[0].role,
    'auditor',
  );
  assert.equal(
    (await rows('select auditor_visible from assignments where id=6'))[0].auditor_visible,
    true,
  );
  await db.exec('delete from assignments where id=6');
  assert.equal(d.sessions.length, 6);
  assert.equal(d.items.length, 16);
  assert.equal(
    d.items.filter((i) => !i.optional).reduce((s, i) => s + Number(i.max_points), 0),
    100,
  );
});
test('students read only own attendance and released grades; auditors get no class data', async () => {
  await as('teacher');
  await rpc(
    'save_attendance',
    1,
    JSON.stringify([
      { uni: 'ab1234', status: 'present' },
      { uni: 'cd5678', status: 'absent' },
    ]),
  );
  await rpc(
    'save_grades',
    JSON.stringify([
      { uni: 'ab1234', item_id: 1, score: 9 },
      { uni: 'cd5678', item_id: 1, score: 6 },
      { uni: 'ab1234', item_id: 2, score: 10 },
    ]),
  );
  await rpc('release_grade_item', 1, true);
  await as('a');
  assert.deepEqual(
    (await rows('select uni from attendance')).map((r) => r.uni),
    ['ab1234'],
  );
  assert.equal((await rows('select * from grades')).length, 1);
  const d = await rpc('class_data');
  assert.equal(d.grades.length, 1);
  assert.equal(d.items.length, 1);
  assert.equal(d.roster, undefined);
  await assert.rejects(
    rpc('save_grades', JSON.stringify([{ uni: 'ab1234', item_id: 1, score: 10 }])),
    /Grading/,
  );
  await assert.rejects(
    db.exec("insert into attendance values('ab1234',2,'present')"),
    /permission denied/,
  );
  for (const who of ['auditor', 'unlisted']) {
    await as(who);
    await assert.rejects(rpc('class_data'), /Class access/);
    for (const t of [
      'attendance',
      'grades',
      'grade_items',
      'group_sets',
      'class_groups',
      'group_memberships',
    ])
      assert.equal((await rows('select * from ' + t)).length, 0);
  }
});
test('grade writes reject over-max scores and rollback an invalid batch', async () => {
  await as('teacher');
  await assert.rejects(
    rpc(
      'save_grades',
      JSON.stringify([
        { uni: 'ab1234', item_id: 1, score: 8 },
        { uni: 'cd5678', item_id: 1, score: 11 },
      ]),
    ),
    /Invalid score/,
  );
  assert.equal(
    Number((await rows("select score from grades where uni='ab1234' and item_id=1"))[0].score),
    9,
  );
});
test('groups enforce capacity, one membership, closed sets, and teammate email privacy', async () => {
  await as('teacher');
  const s = await rpc('create_group_set', 'Week 2 lab', 2, 1, null);
  let d = await rpc('class_data');
  const groups = d.groups.filter((g) => g.set_id === s);
  await as('a');
  await rpc('choose_group', s, groups[0].id, null);
  await as('b');
  await assert.rejects(rpc('choose_group', s, groups[0].id, null), /full/);
  await rpc('choose_group', s, groups[1].id, null);
  d = await rpc('class_data');
  assert.equal(d.members.find((m) => m.group_id === groups[0].id).email, null);
  assert.equal(d.members.find((m) => m.uni === 'cd5678').email, 'cd5678@columbia.edu');
  await assert.rejects(rpc('choose_group', s, null, 'ab1234'), /own group/);
  await as('teacher');
  await rpc('update_group_set', s, false, null);
  await as('a');
  await assert.rejects(rpc('choose_group', s, null, null), /closed/);
  await as('teacher');
  await rpc('choose_group', s, null, 'cd5678');
  await rpc('choose_group', s, groups[1].id, 'ab1234');
  assert.equal((await rows("select * from group_memberships where uni='ab1234'")).length, 1);
});
test('view-as uses the same student projection and blocks every write path', async () => {
  await as('a');
  const actual = await rpc('class_data');
  await assert.rejects(rpc('set_student_preview', 'cd5678'), /Instructor/);
  await as('teacher');
  await rpc('set_student_preview', 'ab1234');
  const access = await rpc('get_access');
  assert.equal(access.role, 'student');
  assert.equal(access.view_as.uni, 'ab1234');
  assert.deepEqual(await rpc('view_as_student', 'ab1234'), actual);
  await assert.rejects(rpc('view_as_student', 'cd5678'), /preview/);
  for (const [fn, args] of [
    ['save_attendance', [1, '[]']],
    ['save_grades', ['[]']],
    ['create_group_set', ['bad', 1, 1, null]],
    ['choose_group', ['00000000-0000-0000-0000-000000000009', null, null]],
    ['replace_roster', ['[{"uni":"ab1234"}]']],
  ])
    await assert.rejects(rpc(fn, ...args), /read-only|Instructor|Grading/);
  await assert.rejects(
    db.exec("insert into allowlist values('new@columbia.edu','instructor')"),
    /read-only|row-level security/,
  );
  await assert.rejects(
    db.exec("insert into storage.objects(bucket_id,name) values('lecture-notes','new.pdf')"),
    /row-level security/,
  );
  await assert.rejects(rpc('list_test_accounts'), /Instructor/);
  await rpc('set_student_preview', null);
  assert.equal((await rpc('get_access')).role, 'instructor');
  await rpc('save_attendance', 2, '[{"uni":"ab1234","status":"excused"}]');
});
test('private test accounts receive stable student identities without exposing their email', async () => {
  await as('test');
  const a = await rpc('get_access');
  assert.equal(a.role, 'student');
  assert.equal(a.uni, 'test1');
  const d = await rpc('class_data');
  assert.equal(d.sessions.length, 6);
  await assert.rejects(rpc('list_test_accounts'), /Instructor/);
  await assert.rejects(rows('select * from private.test_accounts'), /permission denied/);
});
test('roster replacement keeps grades and attendance for returning students', async () => {
  await as('teacher');
  await rpc(
    'replace_roster',
    '[{"uni":"ab1234","name":"Alice updated"},{"uni":"cd5678","name":"Bob"}]',
  );
  assert.equal((await rows("select * from grades where uni='ab1234'")).length, 2);
  assert.equal((await rows("select * from attendance where uni='ab1234'")).length, 2);
});

test('grader quiz entry, including zero, records attendance and preserves manual overrides', async () => {
  await as('grader');
  const d = await rpc('class_data');
  assert.ok(d.roster.every((r) => Object.keys(r).sort().join(',') === 'name,uni'));
  assert.equal(d.groups, undefined);
  await rpc('save_grades', '[{"uni":"ab1234","item_id":8,"score":0}]');
  let a = (await rows("select * from attendance where uni='ab1234' and week=2"))[0];
  assert.equal(a.status, 'excused');
  assert.equal(a.source_quiz, 2);
  assert.equal(a.manual_override, true);
  await rpc('save_attendance', 2, '[{"uni":"ab1234","status":null}]');
  a = (await rows("select * from attendance where uni='ab1234' and week=2"))[0];
  assert.equal(a.status, 'present');
  assert.equal(a.manual_override, false);
  await rpc('save_grades', '[{"uni":"ab1234","item_id":8,"score":null}]');
  assert.equal((await rows("select * from attendance where uni='ab1234' and week=2")).length, 0);
  await rpc('save_grades', '[{"uni":"ab1234","item_id":9,"score":0}]');
  a = (await rows("select * from attendance where uni='ab1234' and week=3"))[0];
  assert.equal(a.status, 'present');
  assert.equal(a.source_quiz, 3);
  await rpc('save_attendance', 3, '[{"uni":"ab1234","status":"absent"}]');
  await rpc('save_grades', '[{"uni":"ab1234","item_id":9,"score":null}]');
  a = (await rows("select * from attendance where uni='ab1234' and week=3"))[0];
  assert.equal(a.status, 'absent');
  assert.equal(a.source_quiz, null);
  await assert.rejects(rpc('release_grade_item', 1, false), /Instructor/);
  await assert.rejects(db.exec('update grade_items set released=true'), /permission denied/);
});
test('audit records identify the grader and contain old/new values; updates, deletes, and truncation fail', async () => {
  await as('teacher');
  const audit = await rows('select * from audit_log');
  assert.ok(
    audit.some(
      (a) => a.actor_id === id('grader') && a.table_name === 'grades' && a.new_row?.score === 0,
    ),
  );
  assert.ok(audit.some((a) => a.old_row && a.new_row && a.operation === 'UPDATE'));
  assert.ok(audit.every((a) => a.changed_at && a.actor_email));
  for (const who of ['teacher', 'grader', 'a', 'auditor', 'unlisted']) {
    await as(who);
    for (const q of [
      "update audit_log set actor_email='fake'",
      'delete from audit_log',
      'truncate audit_log',
    ])
      await assert.rejects(db.exec(q), /permission denied/);
    if (who !== 'teacher') assert.equal((await rows('select * from audit_log')).length, 0);
  }
  await db.exec('reset role');
  for (const q of [
    "update audit_log set actor_email='fake'",
    'delete from audit_log',
    'truncate audit_log',
  ])
    await assert.rejects(db.exec(q), /cannot be changed/);
});
test('CBS self-claims cannot impersonate a student; instructor-approved links control identity', async () => {
  await as('gsb');
  assert.equal((await rpc('get_access')).role, 'unlisted');
  await assert.rejects(rpc('claim_uni', 'ab1234'), /instructor to link/);
  await as('teacher');
  await rpc('link_student_account', 'alias@gsb.columbia.edu', 'ab1234');
  await as('gsb');
  assert.equal((await rpc('get_access')).uni, 'ab1234');
  assert.equal((await rpc('get_access')).role, 'student');
  await assert.rejects(rpc('claim_uni', 'cd5678'), /instructor to link/);
  assert.equal((await rpc('claim_uni', 'ab1234')).uni, 'ab1234');
  await as('teacher');
  await rpc('link_student_account', 'alias@gsb.columbia.edu', null);
  await as('gsb');
  assert.equal((await rpc('get_access')).role, 'unlisted');
});
const tables = [
  'profiles',
  'roster',
  'allowlist',
  'assignments',
  'lecture_files',
  'attendance_sessions',
  'attendance',
  'group_sets',
  'class_groups',
  'group_memberships',
  'grade_items',
  'grades',
  'audit_log',
];
const privateTables = ['test_accounts', 'student_previews', 'student_accounts'];
const fnCases = {
  get_access: [],
  claim_uni: ['cd5678'],
  replace_roster: ['[{"uni":"ab1234"}]'],
  set_student_preview: ['ab1234'],
  set_session_date: [1, '2027-01-01'],
  save_attendance: [1, '[{"uni":"ab1234","status":"present"}]'],
  save_grades: ['[{"uni":"ab1234","item_id":1,"score":8}]'],
  release_grade_item: [1, true],
  create_group_set: ['Forbidden', 1, 1, null],
  update_group_set: ['00000000-0000-0000-0000-000000000099', true, null],
  choose_group: ['00000000-0000-0000-0000-000000000099', null, 'cd5678'],
  view_as_student: ['ab1234'],
  class_data: [],
  list_test_accounts: [],
  link_student_account: ['alias@gsb.columbia.edu', 'ab1234'],
  list_student_accounts: [],
};
test('security catalog covers every app table and RPC, RLS, fixed search paths, and revoked PUBLIC execution', async () => {
  await db.exec('reset role');
  const actual = (
    await rows("select tablename from pg_tables where schemaname='public' order by tablename")
  ).map((r) => r.tablename);
  assert.deepEqual(actual, tables.toSorted());
  assert.equal(
    (
      await rows(
        "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and not c.relrowsecurity",
      )
    ).length,
    0,
  );
  const funcs = await rows(
    "select p.oid, p.proname, p.prosecdef, p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')",
  );
  assert.deepEqual(
    funcs
      .filter((f) => f.nspname === 'public')
      .map((f) => f.proname)
      .sort(),
    Object.keys(fnCases).sort(),
  );
  for (const f of funcs) {
    if (f.prosecdef) assert.ok(f.proconfig.includes('search_path=""'), f.proname);
    assert.equal(
      (await db.query("select has_function_privilege('anon',$1,'execute') allowed", [f.oid]))
        .rows[0].allowed,
      false,
      f.proname,
    );
  }
});
test('per-role forbidden reads/writes on every table and direct private helper calls', async () => {
  await as('teacher');
  await db.exec(
    "insert into assignments values(1,'Hidden','Week 1',10,'Text','Work','Criteria',false),(2,'Shared','Week 2',10,'Text','Work','Criteria',true)",
  );
  await db.exec(
    "insert into lecture_files(week,title,storage_path,auditor_visible) values(1,'Hidden','hidden.pdf',false),(1,'Shared','shared.pdf',true)",
  );
  const insertSQL = {
    profiles: `insert into profiles(id,email,uni) values('${id('a')}','x@columbia.edu','cd5678')`,
    roster: "insert into roster values('xx5555','Fake')",
    allowlist: "insert into allowlist values('evil@columbia.edu','instructor')",
    assignments: "insert into assignments values(6,'Injected','Now',10,'X','X','X',true)",
    lecture_files:
      "insert into lecture_files(week,title,storage_path) values(1,'Injected','injected.pdf')",
  };
  for (const who of ['a', 'grader', 'auditor', 'unlisted', 'anon']) {
    if (who === 'anon') {
      await db.exec('reset role');
      await db.exec("select set_config('request.jwt.claims','{}',false);set role anon");
    } else {
      await as(who);
      await rpc('get_access');
    }
    for (const t of tables) {
      if (who === 'anon') {
        await assert.rejects(rows('select * from ' + t), /permission denied/);
      } else {
        const visible = await rows('select * from ' + t);
        if (t === 'profiles') assert.ok(visible.every((r) => r.id === id(who)));
        else if (['assignments', 'lecture_files'].includes(t)) {
          assert.equal(visible.length, who === 'unlisted' ? 0 : who === 'auditor' ? 1 : 2);
          if (who === 'auditor') assert.ok(visible.every((r) => r.auditor_visible));
        } else if (who === 'a' && ['attendance', 'grades', 'group_memberships'].includes(t))
          assert.ok(visible.every((r) => r.uni === 'ab1234'));
        else if (
          who === 'a' &&
          ['attendance_sessions', 'grade_items', 'group_sets', 'class_groups'].includes(t)
        )
          assert.ok(visible.length > 0);
        else if (
          who === 'grader' &&
          ['attendance', 'grades', 'grade_items', 'attendance_sessions'].includes(t)
        )
          assert.ok(visible.length > 0);
        else assert.equal(visible.length, 0, `${who}: ${t}`);
      }
      await assert.rejects(
        db.exec(insertSQL[t] || `insert into ${t} default values`),
        /permission denied|row-level security/,
        `${who} insert ${t}`,
      );
      for (const sql of [
        `delete from ${t} returning *`,
        `update ${t} set ${t === 'profiles' ? 'email=email' : t === 'roster' ? 'name=name' : t === 'allowlist' ? 'role=role' : t === 'assignments' ? 'title=title' : t === 'lecture_files' ? 'title=title' : t === 'attendance_sessions' ? 'date=date' : t === 'attendance' ? 'status=status' : t === 'group_sets' ? 'title=title' : t === 'class_groups' ? 'number=number' : t === 'group_memberships' ? 'uni=uni' : t === 'grade_items' ? 'released=true' : t === 'grades' ? 'score=score' : 'actor_email=actor_email'} returning *`,
      ]) {
        try {
          assert.equal((await rows(sql)).length, 0, `${who}: ${sql}`);
        } catch (e) {
          if (e.code) assert.match(e.message, /permission denied|row-level security/);
          else throw e;
        }
      }
    }
    for (const t of privateTables)
      for (const verb of ['select * from', 'delete from', 'insert into'])
        await assert.rejects(
          db.exec(`${verb} private.${t}${verb === 'insert into' ? ' default values' : ''}`),
          /permission denied/,
        );
    for (const call of [
      'private.actor_role()',
      'private.current_email()',
      'private.class_roster()',
      "private.student_snapshot('cd5678')",
      'private.assert_writable()',
      'private.require_instructor()',
      'private.require_grader()',
    ])
      await assert.rejects(rows('select ' + call), /permission denied/);
    assert.equal((await rows('select * from storage.objects')).length, 0);
    await assert.rejects(
      db.exec("insert into storage.objects(bucket_id,name) values('lecture-notes','bad.pdf')"),
      /permission denied|row-level security/,
    );
    for (const verb of [
      "update storage.objects set name='bad.pdf' returning *",
      'delete from storage.objects returning *',
    ])
      assert.equal((await rows(verb)).length, 0);
  }
});
test('each role calls each public function, including guessed identities and grader release attempts', async () => {
  for (const who of ['a', 'grader', 'auditor', 'unlisted', 'anon']) {
    if (who === 'anon') {
      await db.exec('reset role');
      await db.exec("select set_config('request.jwt.claims','{}',false);set role anon");
    } else await as(who);
    const allowed =
      who === 'anon'
        ? []
        : [
            'get_access',
            ...(['a', 'grader'].includes(who) ? ['class_data'] : []),
            ...(who === 'grader' ? ['save_grades', 'save_attendance'] : []),
          ];
    for (const [fn, args] of Object.entries(fnCases)) {
      if (allowed.includes(fn)) await rpc(fn, ...args);
      else
        await assert.rejects(
          rpc(fn, ...args),
          /permission denied|access required|read-only|preview|own group|instructor to link/i,
          `${who}: ${fn}`,
        );
    }
  }
});
test('preview rejects all write RPCs and direct old-table writes; auditors are excluded from class roster', async () => {
  await as('teacher');
  await rpc('set_student_preview', 'ab1234');
  for (const [fn, args] of Object.entries(fnCases))
    if (!['get_access', 'set_student_preview', 'view_as_student', 'class_data'].includes(fn))
      await assert.rejects(rpc(fn, ...args), /read-only|Instructor/);
  for (const table of ['allowlist', 'assignments', 'lecture_files'])
    assert.equal((await rows(`delete from ${table} returning *`)).length, 0);
  await assert.rejects(
    db.exec("insert into assignments values(6,'Bad','Now',10,'X','X','X',true)"),
    /read-only|row-level security/,
  );
  await rpc('set_student_preview', null);
  await db.exec("insert into allowlist values('cd5678@columbia.edu','auditor')");
  const d = await rpc('class_data');
  assert.ok(!d.roster.some((r) => r.uni === 'cd5678'));
  await db.exec("delete from allowlist where email='cd5678@columbia.edu'");
  const owner = await rows(
    "update allowlist set role='grader' where email='oh@gsb.columbia.edu' returning *",
  );
  assert.equal(owner.length, 0);
  assert.equal(
    (await rows("delete from allowlist where email='oh@gsb.columbia.edu' returning *")).length,
    0,
  );
});

test('student group snapshot exposes teammate names/emails but never peer UNI fields', async () => {
  await as('teacher');
  const set = await rpc('create_group_set', 'Privacy', 2, 2, null);
  const d = await rpc('class_data');
  const g = d.groups.find((g) => g.set_id === set);
  await rpc('choose_group', set, g.id, 'ab1234');
  await rpc('choose_group', set, g.id, 'cd5678');
  await as('a');
  const student = await rpc('class_data');
  const peer = student.members.find((m) => m.set_id === set && m.email === 'cd5678@columbia.edu');
  assert.equal(peer.name, 'Bob');
  assert.equal(peer.uni, null);
  assert.ok((await rows('select * from group_memberships')).every((m) => m.uni === 'ab1234'));
  await rpc('choose_group', set, null, null);
  assert.ok(
    (await rpc('class_data')).members
      .filter((m) => m.set_id === set)
      .every((m) => m.uni === null && m.name === null && m.email === null),
  );
});
test('forged JWT email cannot assume a higher role after all migrations', async () => {
  await as('a');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id('a'), email: 'oh@gsb.columbia.edu' }),
  ]);
  await assert.rejects(rpc('get_access'), /verified/);
  await assert.rejects(rpc('save_grades', '[]'), /Grading/);
  assert.equal((await rows('select * from grades')).length, 0);
});
