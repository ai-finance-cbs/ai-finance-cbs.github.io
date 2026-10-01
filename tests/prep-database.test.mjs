import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { phaseDatabase } from './helpers/phase-a.mjs';
let h, speaker;
const values = (change = {}) => Object.values({ id:null, name:'Private guest canary 9ad682', affiliation:'Example firm', topic:'Private topic', week:3, status:'Idea', contact:'guest@example.test', notes:'Private speaker notes canary 85ac17', ...change });
before(async () => {
  h = await phaseDatabase(); await h.as('teacher');
  await h.rpc('save_instructor_note', 1, 'Private preparation canary e4c159');
  speaker = await h.rpc('save_speaker', ...values());
});
after(async () => h?.db.close());

test('instructor reads and edits global notes and speakers; generated metadata stays server-owned', async () => {
  await h.as('teacher');
  assert.equal((await h.rows('select * from instructor_notes where week=1'))[0].body, 'Private preparation canary e4c159');
  const first = await h.rpc('save_instructor_note', 2, 'Before');
  const saved = await h.rpc('save_instructor_note', 2, 'After');
  assert.equal(saved.body, 'After'); assert.ok(new Date(saved.updated_at) >= new Date(first.updated_at));
  const changed = await h.rpc('save_speaker', ...values({ id:speaker.id, name:'Updated guest', status:'Confirmed' }));
  assert.equal(changed.id, speaker.id); assert.equal(changed.created_at, speaker.created_at); assert.equal(changed.status, 'Confirmed');
  const disposable = await h.rpc('save_speaker', ...values({ name:'Delete me' }));
  await h.rpc('delete_speaker', disposable.id);
  assert.deepEqual(await h.rows('select id from speakers where id=$1', [disposable.id]), []);
  for (const sql of ["update instructor_notes set updated_at=now()", "update speakers set created_at=now()", "update speakers set id=gen_random_uuid()", "delete from instructor_notes", "insert into speakers(name) values('Bypass')"])
    await assert.rejects(h.rows(sql), /permission denied/);
});

for (const who of ['grader','a','auditor','outside','anon','preview']) test(`${who} cannot read or write either instructor table or call its save/delete RPCs`, async () => {
  await h.as(who === 'preview' ? 'teacher' : who);
  if (who === 'preview') await h.rpc('set_student_preview', 'aa1001');
  for (const table of ['instructor_notes','speakers']) {
    if (who === 'anon') await assert.rejects(h.rows(`select * from ${table}`), /permission denied/);
    else assert.deepEqual(await h.rows(`select * from ${table}`), []);
    for (const sql of [`insert into ${table} default values`, `delete from ${table}`, `update ${table} set ${table === 'speakers' ? 'name=name' : 'body=body'}`])
      await assert.rejects(h.rows(sql), /permission denied/);
  }
  for (const [rpc, args] of [['save_instructor_note',[1,'Forbidden']], ['save_speaker',values()], ['save_speaker',values({id:speaker.id})], ['delete_speaker',[speaker.id]]])
    await assert.rejects(h.rpc(rpc, ...args), /Instructor|read-only|permission denied/);
  if (who === 'preview') await h.rpc('set_student_preview', null);
});

test('database enforces note/week bounds and every speaker field limit', async () => {
  await h.as('teacher');
  await h.rpc('save_instructor_note', 6, 'x'.repeat(50000));
  for (const [week, body] of [[0,''],[7,''],[1,null],[1,'x'.repeat(50001)]]) await assert.rejects(h.rpc('save_instructor_note', week, body), /constraint/);
  for (const [key, limit] of Object.entries({name:200,affiliation:300,topic:500,contact:2000,notes:10000})) {
    const row = await h.rpc('save_speaker', ...values({ [key]:'x'.repeat(limit) }));
    await h.rpc('delete_speaker', row.id);
    await assert.rejects(h.rpc('save_speaker', ...values({ [key]:'x'.repeat(limit + 1) })), /constraint/);
  }
  for (const change of [{name:'  '},{name:null},{week:0},{week:7},{status:'Unknown'},{status:null},{notes:null}])
    await assert.rejects(h.rpc('save_speaker', ...values(change)), /constraint/);
  const blankWeek = await h.rpc('save_speaker', ...values({week:null})); assert.equal(blankWeek.week, null);
  for (const rpc of ['save_speaker','delete_speaker']) await assert.rejects(h.rpc(rpc, ...(rpc === 'delete_speaker' ? ['00000000-0000-0000-0000-000000000099'] : values({id:'00000000-0000-0000-0000-000000000099'}))), /not found/);
});

test('audit captures insert, update and delete with actor and before/after values', async () => {
  await h.as('teacher');
  const logs = await h.rows("select * from audit_log where table_name in ('instructor_notes','speakers') order by changed_at,id");
  for (const [table, operations] of [['instructor_notes',['INSERT','UPDATE']], ['speakers',['INSERT','UPDATE','DELETE']]])
    for (const operation of operations) assert.ok(logs.some(l => l.table_name === table && l.operation === operation && l.actor_email === 'oh@gsb.columbia.edu'));
  const update = logs.find(l => l.table_name === 'instructor_notes' && l.operation === 'UPDATE');
  assert.equal(update.old_row.body, 'Before'); assert.equal(update.new_row.body, 'After');
});

test('both tables use SELECT column grants only, instructor RLS, and preview/audit triggers', async () => {
  await h.as('owner');
  for (const table of ['instructor_notes','speakers']) {
    for (const role of ['anon','authenticated']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
      assert.equal((await h.rows('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege]))[0].allowed,false,`${role} ${table} ${privilege}`);
    assert.equal((await h.rows("select has_any_column_privilege('authenticated',$1,'SELECT') allowed",[table]))[0].allowed,true);
    const triggers = await h.rows('select tgname from pg_trigger where tgrelid=$1::regclass and not tgisinternal',[table]);
    assert.deepEqual(triggers.map(t => t.tgname).sort(), ['change_audit','preview_guard']);
    const policy = (await h.rows('select qual from pg_policies where tablename=$1',[table]))[0].qual;
    assert.match(policy,/instructor_workspace/);
  }
  const predicate = (await h.rows("select pg_get_functiondef('private.instructor_workspace()'::regprocedure) body"))[0].body;
  assert.match(predicate,/actor_role\(\)='instructor'/); assert.match(predicate,/preview_uni\(\) is null/);
  await h.as('teacher'); await h.rpc('set_student_preview','aa1001');
  await h.db.query('reset role'); // Table owner bypasses RLS; preview triggers must still stop writes.
  for (const sql of ["insert into instructor_notes(week,body) values(5,'Bypass')", "update instructor_notes set body='Bypass' where week=1", "delete from instructor_notes where week=1", "insert into speakers(name) values('Bypass')", "update speakers set name='Bypass'", "delete from speakers"])
    await assert.rejects(h.rows(sql),/read-only/);
  await h.as('teacher'); await h.rpc('set_student_preview',null);
});

test('opening Spring 2028 preserves the same notes and speakers without copying or term scoping', async () => {
  await h.as('teacher');
  const notes = await h.rows('select * from instructor_notes order by week'), speakers = await h.rows('select * from speakers order by id');
  await h.rpc('open_term','Spring 2028');
  assert.deepEqual(await h.rows('select * from instructor_notes order by week'),notes);
  assert.deepEqual(await h.rows('select * from speakers order by id'),speakers);
  await h.rpc('save_instructor_note',1,'Still editable');
  assert.equal((await h.rows('select body from instructor_notes where week=1'))[0].body,'Still editable');
});
