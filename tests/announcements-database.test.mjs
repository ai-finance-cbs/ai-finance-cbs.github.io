import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { bootstrapSQL, migrationFiles, seedGoogleIdentity } from './helpers/database.mjs';
let db, announcement;
const people = ['oh@gsb.columbia.edu','ab1234@columbia.edu','grader@columbia.edu','auditor@columbia.edu','unlisted@columbia.edu'];
const id = index => `10000000-0000-0000-0000-00000000000${index}`;
async function as(index) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(index === null ? {} : {sub:id(index),email:people[index]})]);
  await db.exec(`set role ${index === null ? 'anon' : 'authenticated'}`);
}
const rows = async sql => (await db.query(sql)).rows;
before(async () => {
  db = new PGlite(); await db.exec(bootstrapSQL);
  for (const [index,email] of people.entries()) {
    await db.query('insert into auth.users values($1,$2,now(),$3)', [id(index),email,JSON.stringify({provider:'google'})]);
    await seedGoogleIdentity(db,id(index),email);
  }
  for (const file of migrationFiles) await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await db.exec("insert into roster values('ab1234','Demo Student'); insert into allowlist values('grader@columbia.edu','grader'),('auditor@columbia.edu','auditor')");
});
after(async () => db?.close());

test('instructors create, edit, delete announcements with automatic dates and an immutable audit trail', async () => {
  await as(0);
  announcement = (await rows("insert into announcements(title,body) values('Before class','Read the required items.') returning *"))[0];
  assert.ok(announcement.id); assert.ok(announcement.created_at);
  await db.exec("update announcements set title='',body='Updated body.'");
  assert.deepEqual((await rows('select * from announcements'))[0].created_at, announcement.created_at);
  const audit = await rows("select * from audit_log where table_name='announcements' order by id");
  assert.deepEqual(audit.map(a => a.operation), ['INSERT','UPDATE']);
  assert.equal(audit[1].actor_email, people[0]);
  assert.equal(audit[1].old_row.body, 'Read the required items.');
  assert.equal(audit[1].new_row.body, 'Updated body.');
  for (const sql of ["update announcements set created_at=now()", "update announcements set id=gen_random_uuid()", "truncate announcements", "update audit_log set actor_email='forged'"]) await assert.rejects(db.exec(sql), /permission denied/);
  for (const body of ['', '   ', 'x'.repeat(2001)]) await assert.rejects(db.query('insert into announcements(body) values($1)', [body]), /check constraint/);
  await assert.rejects(db.query('insert into announcements(title,body) values($1,$2)', ['x'.repeat(201),'body']), /check constraint/);
});

test('all signed-in course roles read announcements and dates; only instructor can write', async () => {
  for (const index of [1,2,3,4,null]) {
    await as(index);
    if (index === null) {
      await assert.rejects(rows('select * from announcements'), /permission denied/);
      await assert.rejects(rows('select * from attendance_sessions'), /permission denied/);
    } else {
      assert.equal((await rows('select * from announcements')).length, index === 4 ? 0 : 1);
      assert.equal((await rows('select * from attendance_sessions')).length, index === 4 ? 0 : 6);
      if (index === 3) {
        for (const table of ['attendance','grades','grade_items','group_sets','group_memberships','class_groups','roster']) assert.equal((await rows(`select * from ${table}`)).length, 0);
        await assert.rejects(db.exec('select class_data()'), /Class access required/);
      }
    }
    await assert.rejects(db.exec("insert into announcements(title,body) values('Forged','Forbidden')"), /permission denied|row-level security/);
    for (const sql of ["update announcements set body='Forged' returning *", 'delete from announcements returning *']) {
      if (index === null) await assert.rejects(rows(sql), /permission denied/);
      else assert.deepEqual(await rows(sql), []);
    }
  }
  await as(0);
  assert.equal((await rows('select * from announcements'))[0].body, 'Updated body.');
  assert.equal((await rows("select * from audit_log where table_name='announcements'")).length, 2);
});

test('instructor preview reads announcements but cannot insert, edit, delete, or change dates', async () => {
  await as(0); await db.exec("select set_student_preview('ab1234')");
  assert.equal((await rows('select * from announcements')).length, 1);
  await assert.rejects(db.exec("insert into announcements(body) values('Forbidden')"), /read-only|row-level security/);
  assert.deepEqual(await rows("update announcements set body='Forbidden' returning *"), []);
  assert.deepEqual(await rows('delete from announcements returning *'), []);
  await assert.rejects(db.exec("select set_session_date(1,'2027-01-17')"), /read-only/);
  await db.exec('select set_student_preview(null)');
  assert.equal((await rows('select * from announcements'))[0].body, 'Updated body.');
  await db.exec('delete from announcements');
  assert.equal((await rows("select * from audit_log where table_name='announcements' and operation='DELETE'")).length, 1);
});
