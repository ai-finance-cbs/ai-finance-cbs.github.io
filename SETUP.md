# Class tools: local build and review

The existing Jekyll site uses Supabase and Google sign-in. Keep the current public connection settings.
This task adds local code only. Migration `003_class_tools.sql` has not been applied to the linked project.
Do not publish these browser changes before the matching migration and file function pass review.

## Preview locally (five minutes)

1. Open Terminal. Run `cd ~/Github/ai-finance-cbs`.
2. Run `npm install`. Use Node.js 22 or newer.
3. Run `npm run dev`, or `npm run build` if port 4173 already serves `_site`.
4. Open `http://127.0.0.1:4173/materials/gradebook/?fakeauth=instructor`.
5. Replace `instructor` with `grader`, `student`, `auditor`, `unlisted`, or `test` to inspect each role.
6. Demo records are synthetic. Changes remain in the browser tab. Reloading preserves them; closing the tab clears them.
7. The demo switch works only on `http://127.0.0.1`. The live hostname ignores it.

The local check suite disables real Supabase configuration in browser tests. It never signs into the linked project.
The original Admin page is archived under `__archive__/20261001/before-class-tools/admin.html`.

## Roles

| Role | Reads | Writes |
| --- | --- | --- |
| Instructor | All course data and audit records | Roster, files, settings, groups, dates, scores, attendance, grade release |
| Grader | Materials, names/UNIs needed for grading, scores and attendance | Scores and attendance only |
| Student | Materials, own attendance, own released grades, group availability | Own group membership while sign-up is open |
| Auditor | Materials marked auditor-visible | None |
| Unlisted / anonymous | Public site only | None |

Owner `oh@gsb.columbia.edu` remains Instructor. The website cannot remove, rename, or downgrade this row.
Auditors are excluded from gradebook rows, including auditors whose UNIs also appear in the uploaded roster.
Only an instructor can read the private test-account list. Test emails are never shared with classmates.

## Instructor workflow

1. Open **Roster**. Choose the Canvas CSV and select **Preview roster**.
2. Review valid UNIs and flagged rows. Confirm replacement and select **Replace roster**.
3. **Settings → Role access** assigns Instructor, Grader, or Auditor by verified Columbia email.
4. For a CBS email alias, verify its owner, then use **Settings → CBS account links** to link the email and UNI.
5. `uni@columbia.edu` accounts use their verified email UNI automatically.
6. Self-entered CBS UNIs no longer grant access. Earlier self-claims must receive an instructor-approved account link.
7. **Files** manages PDF uploads, auditor visibility, and deletion. Maximum PDF size remains 20 MB.
8. **Settings** edits assignment text and shows read-only test accounts.
9. **Attendance** edits six session dates and records present, absent, or excused statuses.
10. Attendance CSVs accept a UNI column or one UNI per line. Imports mark listed students present only.
11. **Groups** creates sets with a group count, maximum size, optional deadline, and open/closed state.
12. Students may join, switch, or leave while open. Instructors can move or remove students and export membership.
13. Group availability is public within the class. Names and emails appear to students only for their own teammates.
14. **Roster → View as** and the header dropdown show the selected student's materials and records.
15. Preview is read-only across the instructor's account, including other tabs. Select **Exit** before making changes.

## Grading workflow

1. Sign in as Grader or Instructor. Open **Gradebook**.
2. Choose one item under **Column entry**, or use the full grid.
3. Enter scores. Enter or Arrow Down moves to the next student; Tab moves across columns.
4. Select **Save scores**. Blank cells mean ungraded; zero is a recorded score.
5. For one item, import a CSV with exactly `uni,score` columns. Preview it, then select **Import scores**.
6. The full-grid export provides a CSV template for multiple items. Unknown or duplicate rows reject the entire import.
7. Imported blank score cells clear existing scores in those columns.
8. Quiz 1–5 scores automatically mark Weeks 1–5 present, including scores of zero. Week 6 uses manual attendance.
9. Attendance shows `from Quiz N`. Manual changes take precedence over later quiz changes.
10. **Use quiz or clear** removes a manual override. It restores present when that week's quiz score exists.
11. Clearing a quiz removes automatic attendance. It retains manual attendance and removes the quiz source label.
12. Only Instructor can release an item. Students see released items under **Attendance → My grades**.
13. Core maximum is 100. Optional points cap at 15. Overall total caps at 100.
14. Totals use recorded scores and mark incomplete records. Student totals include released items only.

## Database and function review

1. Read `003_class_tools.sql` after the already-applied `001` and `002` migrations. Do not edit applied migration files.
2. Migration `003` converts `instructor_ta` to `instructor` and `observer` to `auditor`.
3. It renames both visibility columns to `auditor_visible` and preserves existing content and flags.
4. It creates attendance, groups, grade items, scores, append-only audit records, account links, and server-side preview state.
5. All application tables enable RLS. New data tables allow browser reads only; checked SQL functions perform mutations.
6. Grader writes cannot change release flags, roles, roster, assignments, files, groups, dates, or account links.
7. Grade and attendance triggers record actor, timestamp, operation, and old/new rows. Only instructors read audit records.
8. Browser roles cannot insert, update, delete, or truncate audit records. Triggers also reject privileged update/delete/truncate.
9. Preview uses the same student projection and returns other members' UNI fields as null.
10. Definer functions use an empty search path and revoke PUBLIC execution. Internal helpers remain private.
11. The file handler now checks `instructor`. Deploying it with the old migration would reject instructor file writes.
12. A reviewer must coordinate migration `003`, the `lecture-file` function, and browser publication in a later approved task.
13. Real Google GIS, OAuth fallback, hosted RLS, and hosted PDF storage still need that reviewer's smoke test.

No hosted migration, function deployment, keychain access, account creation, or push occurred in this task.
For a fresh database, apply `001`, `002`, then `003`. Existing legacy private seeds use `observer_visible` and belong before `003`.
New seeds from `tools/create-materials-seed.rb` use `auditor_visible` and belong after `003`.
Keep seeds and real roster files out of Git and `_site`.

## Local checks

```sh
npm run check
RUN_DB_LINT=1 node --test tests/group-concurrency.test.mjs
```

`npm run check` builds Jekyll, runs Node/PGlite tests and a native PostgreSQL concurrency test, then runs Chromium tests.
The embedded PostgreSQL dependency creates a temporary cluster bound to `127.0.0.1` and removes it afterward.
Its install script restores bundled library links. If npm blocks that script on another platform, approve the matching `@embedded-postgres/<platform>` package.
No system database service or account is created.

Denial tests cover every application table and public RPC for Student, Grader, Auditor, Unlisted, and anonymous callers.
They also cover private helpers, owner protection, forged identities, preview writes, audit immutability, and grader release attempts.
A native two-connection test verifies last-seat contention and a set lock committed while a join waits.

Local catalog checks enforce RLS, function search paths, closed anonymous execution, and expected table/function coverage.
`supabase db lint` was attempted against the temporary loopback database only.
The bundled PostgreSQL lacks `plpgsql_check`, so the CLI cannot complete lint. This is a tool limitation, not a clean lint result.
See `evidence/class-tools/db-lint.txt`. Hosted Supabase security advisor checks remain for the later review.
Browser reports are in `playwright-report/`; screenshots are in `evidence/class-tools/`.
