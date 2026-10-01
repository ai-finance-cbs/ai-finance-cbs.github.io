import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { bootstrapSQL } from './helpers/database.mjs';
const uid = (n) => `00000000-0000-0000-0000-00000000000${n}`;
async function authenticate(client, n, email) {
  await client.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: uid(n), email }),
  ]);
  await client.query('set role authenticated');
}
async function rpc(client, name, args = []) {
  return (
    await client.query(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`,
      args,
    )
  ).rows[0].value;
}
test(
  'real PostgreSQL serializes competing joins before counting the last seat',
  { timeout: 30000 },
  async () => {
    const listener = createServer();
    await new Promise((r) => listener.listen(0, '127.0.0.1', r));
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const pg = new EmbeddedPostgres({
      databaseDir: await mkdtemp(join(tmpdir(), 'b8403-pg-')),
      port,
      user: 'postgres',
      password: 'local-test-only',
      persistent: false,
      initdbFlags: ['--locale=C', '--encoding=UTF8'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
      onLog: () => {},
      onError: () => {},
    });
    const clients = [];
    try {
      await pg.initialise();
      await pg.start();
      for (let i = 0; i < 4; i++) {
        const c = pg.getPgClient('postgres', '127.0.0.1');
        await c.connect();
        clients.push(c);
      }
      const [owner, instructor, a, b] = clients;
      await owner.query(bootstrapSQL);
      for (const file of [
        '001_course_materials.sql',
        '002_test_accounts.sql',
        '003_class_tools.sql',
      ])
        await owner.query(
          await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'),
        );
      for (const [i, email] of [
        [1, 'oh@gsb.columbia.edu'],
        [2, 'ab1234@columbia.edu'],
        [3, 'cd5678@columbia.edu'],
      ])
        await owner.query('insert into auth.users values($1,$2,now(),\'{"provider":"google"}\')', [
          uid(i),
          email,
        ]);
      await owner.query("insert into roster values('ab1234','Alice'),('cd5678','Bob')");
      await authenticate(instructor, 1, 'oh@gsb.columbia.edu');
      await authenticate(a, 2, 'ab1234@columbia.edu');
      await authenticate(b, 3, 'cd5678@columbia.edu');
      const set = await rpc(instructor, 'create_group_set', ['Race', 2, 1, null]);
      const groups = (await rpc(instructor, 'class_data')).groups;
      await a.query('begin');
      await rpc(a, 'choose_group', [set, groups[0].id, null]);
      const pid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
      const competing = rpc(b, 'choose_group', [set, groups[0].id, null]).then(
        () => ({ ok: true }),
        (e) => ({ error: e }),
      );
      let locked = false;
      for (let i = 0; i < 100; i++) {
        locked = (
          await owner.query(
            "select wait_event_type='Lock' locked from pg_stat_activity where pid=$1",
            [pid],
          )
        ).rows[0].locked;
        if (locked) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(locked, true, 'Second join must wait on the uncommitted first join.');
      await a.query('commit');
      assert.match((await competing).error.message, /full/);
      assert.equal(
        Number(
          (
            await owner.query('select count(*) n from group_memberships where group_id=$1', [
              groups[0].id,
            ])
          ).rows[0].n,
        ),
        1,
      );
      // A set lock committed while a student waits must stop the waiting request.
      await instructor.query('begin');
      await rpc(instructor, 'update_group_set', [set, false, null]);
      const waiting = rpc(b, 'choose_group', [set, groups[1].id, null]).then(
        () => ({ ok: true }),
        (e) => ({ error: e }),
      );
      for (let i = 0; i < 100; i++) {
        locked = (
          await owner.query(
            "select wait_event_type='Lock' locked from pg_stat_activity where pid=$1",
            [pid],
          )
        ).rows[0].locked;
        if (locked) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(locked, true);
      await instructor.query('commit');
      assert.match((await waiting).error.message, /closed/);
      if (process.env.RUN_DB_LINT === '1') {
        await mkdir('evidence/class-tools', { recursive: true });
        const args = [
          'db',
          'lint',
          '--db-url',
          `postgresql://postgres:local-test-only@127.0.0.1:${port}/postgres?sslmode=disable`,
          '--schema',
          'public,private',
          '--fail-on',
          'warning',
        ];
        try {
          const result = await promisify(execFile)('supabase', args, {
            timeout: 15000,
            env: { ...process.env, PGSSLMODE: 'disable' },
          });
          await writeFile('evidence/class-tools/db-lint.txt', result.stdout + result.stderr);
          console.log('Local Supabase lint:', result.stdout.trim());
        } catch (error) {
          await writeFile(
            'evidence/class-tools/db-lint.txt',
            (error.stdout || '') +
              (error.stderr || '') +
              '\n' +
              error.message.replace(/postgresql:\/\/[^ ]+/g, '[local test database]'),
          );
          console.log('Local Supabase lint unavailable; see evidence/class-tools/db-lint.txt.');
        }
      }
    } finally {
      await Promise.all(
        clients.map(async (c) => {
          await c.query('rollback').catch(() => {});
          await c.end();
        }),
      );
      await pg.stop();
    }
  },
);
