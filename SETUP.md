# Class tools: local build and review

The existing Jekyll site uses Supabase and Google sign-in. Keep the current public connection settings.
This task adds local code only. Migrations `003_class_tools.sql` and `004_security_hardening.sql` have not been applied to the linked project.
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

1. Open **Roster → Replace roster from Canvas CSV**. Choose the CSV and select **Preview roster**.
2. Review valid UNIs and flagged rows. Confirm replacement and select **Replace roster**.
3. **Settings → Role access** assigns Instructor, Grader, or Auditor by verified Columbia email.
4. For a CBS email alias, verify its owner, then use **Settings → CBS account links** to link the email and UNI.
5. `uni@columbia.edu` accounts use their verified email UNI automatically.
6. Self-entered CBS UNIs no longer grant access. Earlier self-claims must receive an instructor-approved account link.
7. **Files** manages PDF uploads, auditor visibility, and deletion. Maximum PDF size remains 20 MB.
8. **Settings** has five collapsible sections: announcements, access, assignments, CBS links, and read-only test accounts.
9. **Attendance** edits six session dates and records present, absent, or excused statuses.
10. Open **Import attendance CSV** for a UNI column or one UNI per line. Imports mark listed students present only.
11. **Groups** creates sets with a group count, maximum size, optional deadline, and open/closed state.
12. Students may join, switch, or leave while open. Instructors can move or remove students and export membership.
13. Group availability is public within the class. Names and emails appear to students only for their own teammates.
14. **Roster → View as** and the header dropdown show the selected student's materials and records.
15. Preview is read-only across the instructor's account, including other tabs. Select **Exit** before making changes.

## Grading workflow

1. Sign in as Grader or Instructor. Open **Gradebook**.
2. Choose one item from **All grading items**, or keep the full grid.
3. Enter scores. Enter or Arrow Down moves to the next student; Tab moves across columns.
4. Select **Save scores**. Blank cells mean ungraded; zero is a recorded score.
5. Open **Import scores CSV**. For one item, use `UNI,Q1` (or the selected item code). Legacy `uni,score` still works. Preview it, then select **Import scores**.
6. The full-grid export provides a CSV template for multiple items. Unknown or duplicate rows reject the entire import.
7. Imported blank score cells clear existing scores in those columns.
8. Quiz 1–5 scores automatically mark Weeks 1–5 present, including scores of zero. Week 6 uses manual attendance.
9. Grading staff see a small `QN` marker. Its tooltip explains the source; `*` marks a manual override. Students see the source only after quiz release. Manual changes retain precedence.
10. **Quiz / clear** removes a manual override. It restores present when that week's quiz score exists.
11. Clearing a quiz removes automatic attendance. It retains manual attendance and removes the quiz source label.
12. Only Instructor can release an item. Students see released items under **Attendance → My grades**.
13. Core maximum is 100. Optional points cap at 15. Overall total caps at 100.
14. Totals use recorded scores and mark incomplete records. Student totals include released items only.

## Database and function review

1. Review `003_class_tools.sql` and `004_security_hardening.sql` together after the already-applied `001` and `002` migrations.
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
12. A reviewer must coordinate migrations `003` and `004`, the file function, and browser publication in a later approved task.
13. Real Google GIS, OAuth fallback, hosted RLS, and hosted PDF storage still need that reviewer's smoke test.

No hosted migration, function deployment, keychain access, account creation, or push occurred in this task.
For a fresh database, apply `001`, `002`, `003`, `004`, then `005` after review. Existing legacy private seeds use `observer_visible` and belong before `003`.
New seeds from `tools/create-materials-seed.rb` use `auditor_visible` and belong after `003`.
Keep seeds and real roster files out of Git and `_site`.
Named test-account seeding now belongs in the ignored `supabase/private/test-accounts.sql` file, after migration `004`.
Migration `002` remains unchanged history. Migration `004` preserves existing test rows and contains no account seed.
Public tests use synthetic account addresses only.

## Security review fixes

1. Migration `004` requires the Auth email to match a verified Google identity in `auth.identities`.
2. Changing an Auth email and JWT without that identity match grants no course role.
3. Private test accounts require the same verified Google identity.
4. All application RPCs explicitly revoke `anon` and PUBLIC execution. Authenticated role checks still apply.
5. The test bootstrap emulates Supabase's direct default function, table, and sequence grants.
6. Raw attendance reads are now limited to Instructor and Grader. Students use the filtered `class_data` response.
7. Student and preview responses hide both `source_quiz` and `manual_override` until the matching quiz is released.
8. Manual attendance without a released quiz uses the same empty source fields. A hidden quiz cannot be inferred from them.
9. `claim_uni` has been dropped. The obsolete UNI form and browser calls have been removed.
10. Approved CBS account links resolve automatically when access is checked; no student claim step is needed.

## Local checks

```sh
npm run check
RUN_DB_LINT=1 node --test tests/group-concurrency.test.mjs
```

`npm run check` builds Jekyll, runs Node/PGlite tests and a native PostgreSQL concurrency test, then runs Chromium tests.
The embedded PostgreSQL dependency creates a temporary cluster bound to `127.0.0.1` and removes it afterward.
Its install script restores bundled library links. If npm blocks that script on another platform, approve the matching `@embedded-postgres/<platform>` package.
No system database service or account is created.

Denial tests cover every application table and remaining public RPC for Student, Grader, Auditor, Unlisted, and anonymous callers.
They also cover private helpers, owner protection, forged identities, preview writes, audit immutability, and grader release attempts.
A native two-connection test verifies last-seat contention and a set lock committed while a join waits.

Local catalog checks enforce RLS, function search paths, closed anonymous execution, and expected table/function coverage.
`supabase db lint` was attempted against the temporary loopback database only.
The bundled PostgreSQL lacks `plpgsql_check`, so the CLI cannot complete lint. This is a tool limitation, not a clean lint result.
See `evidence/class-tools/db-lint.txt`. Hosted Supabase security advisor checks remain for the later review.
Browser reports are in `playwright-report/`; screenshots are in `evidence/class-tools/`.

## Compact class tools

The compact UI uses the existing database and RPCs. It adds no migration.
Attendance keeps present, absent, and excused overrides. Quiz scores remain the main attendance source.

1. Filter Attendance, Gradebook, and Roster by name or UNI. The count shows matching students.
2. Attendance totals always cover the full class. **Mark all present** also covers the full class after confirmation.
3. Manual attendance saves immediately. A failed save restores the previous selection and displays an error.
4. Filtering the gradebook retains unsaved scores. Enter and arrow keys skip hidden students.
5. Headers stay visible during vertical table scrolling. Student names and UNIs stay visible during horizontal scrolling.
6. The header holds the preview name, **Read-only**, and **Exit**, beside the Student badge.
7. A small header tag identifies local synthetic demos. It does not appear outside demo mode.

`npm run check` includes the compact UI browser tests. Screenshots are written to `evidence/compact-ui/`.
They cover 1440px and 390px views with a synthetic class. Evidence remains local and Git-ignored.

## Upcoming and announcements

Course Materials now opens **Upcoming**. The submenu retains Assignments and Lecture Notes.
Upcoming uses the earliest Attendance date that is today or later, in New York time.
If no dates are set, it uses Week 1. After all dated classes finish, it shows a finished-course message.
Only configured date, time, and room details appear. Attendance currently stores dates only.

Required readings come from `_data/materials.yml` at build time. No private assignment text enters generated pages.
The milestone uses that week's assignment ID, matching the Schedule's existing assignment mapping.
PDFs obey existing visibility checks. When current notes are absent, Upcoming shows the previous week's available notes.
Students see open group reminders or their own group and teammates. Auditors see readings, permitted PDFs, and announcements.

1. Apply `005_announcements.sql` after `004`, following review, before publishing this browser version.
2. Migration 005 adds announcements with role-based reads and Instructor-only writes.
3. It also grants auditors read access to session dates. Attendance records, grades, and groups remain restricted.
4. In Settings, open **Announcements**. The title is optional; body text is required.
5. Use **Post announcement**, or open an existing announcement to edit or delete it.
6. Dates are automatic and immutable. Title/body limits are 200/2,000 characters. Text is displayed literally.
7. Preview remains read-only. Every announcement change creates an immutable audit record.

Gradebook headers, the item picker, and CSV exports use M1–M5, FP, Q1–Q5, PA, and O1–O4.
The closed **Legend** explains names, points, quiz attendance, and the optional-points cap.
Imports accept these codes, existing full names, and existing `item_N` headers. Duplicate aliases reject the import.
Student My grades keeps full names.

The header uses the same 136px height on all pages. Desktop title/menu/submenu start at 12/49/78px.
The submenu list spans 84–122px. Desktop navigation stays on one line and scrolls internally when necessary.
The geometry test includes Upcoming across 14 pages, seven account states, and five widths.
Screenshots and check output for this change live in `evidence/upcoming/`.
Migration 005 is local and unapplied to the hosted database. No push or db push was run.
