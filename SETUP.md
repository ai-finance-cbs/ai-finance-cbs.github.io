# Course site: local build and review

The existing Jekyll site uses Supabase and Google sign-in. Keep the current public connection settings.
Migrations 001–011 are live. Main is now `9c47771`; migrations 012–014 remain local and unapplied.
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
| Grader | Materials, submissions, groups, names/UNIs needed for grading, scores and attendance | Scores and attendance only |
| Student | Materials, own attendance, own released grades, permitted submissions and groups | Own ungraded submissions; group changes when permitted |
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
7. **Settings → Files** manages PDF uploads, categories, release times, Auditor visibility, and deletion. Maximum PDF size remains 20 MB.
8. **Settings** also contains session times, submission settings, storage usage, and manual term rollover.
9. **Attendance** edits six session dates and records present, absent, or excused statuses.
10. Open **Import attendance CSV** for a UNI column or one UNI per line. Imports mark listed students present only.
11. **Groups** creates sets with a group count, maximum size, optional deadline, and open/closed state.
12. Students can change groups while sign-up is open and neither group has submitted work. Instructor moves remain allowed.
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
12. Only Instructor can release an item. Students see released scores and comments under **Grades**.
13. Core maximum is 100. Optional points cap at 15. Overall total caps at 100.
14. Totals use recorded scores. The Total tooltip identifies ungraded items. Student totals include released items only.

## Database and function review

1. Migrations 001–005 are already applied. The following notes describe their retained security rules; Phase A adds 006–008.
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
12. Migrations 001–011 are live. A later authorized release must apply 012–014 before publishing the Preparation and Speakers pages.
13. Real Google GIS, OAuth fallback, hosted RLS, and hosted PDF storage still need that reviewer's smoke test.

No hosted migration, function deployment, keychain access, account creation, or push occurred in this task.
For a fresh database, apply migrations 001–014 in order after review.
Legacy seeds using `observer_visible` belong before `003`. The older generator targets the schema after `003` and before `006`.
The current ignored `supabase/private/seed.sql` uses explicit term values and belongs after 006–008.
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
Only configured date, time, and room details appear. Phase A adds session start and end times beside the date.

Required readings come from `_data/materials.yml` at build time. No private assignment text enters generated pages.
The milestone uses that week's assignment ID, matching the Schedule's existing assignment mapping.
PDFs obey existing visibility checks. When current notes are absent, Upcoming shows the previous week's available notes.
Students see open group reminders or their own group and teammates. Auditors see readings, permitted PDFs, and announcements.

1. Migration `005_announcements.sql` is already applied live, as confirmed in the round 1 review.
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

The merged `77b18e5` header uses 148px on desktop and 136px on phones.
Desktop title/menu/submenu start at 15/54/91px. Navigation scrolls internally when necessary.
The geometry test includes Upcoming across 14 pages, seven account states, and five widths.
Screenshots and check output for this change live in `evidence/upcoming/`.
Migrations 001–011 are now live. Migrations 012–014 remain local and unapplied.

## Phase A: terms, submissions, and group grades

Phase A adds the data layer for the week pages. Existing pages and menus remain in place.
Migrations `006_terms_and_release.sql`, `007_submissions.sql`, and `008_grading.sql` follow the unchanged 001–005 files.
Migration 005 is already applied live. This branch has not changed any hosted service.

Spring 2027 is the initial active term. Each course record carries a `term_id`.
Instructions remain in `assignments`; they also have term keys to preserve old course content.
Students can read their own active or archived-readable terms. Closed terms exclude students.
Staff can read older terms through `classData(termId)`. All editing methods target the active term.
Phase C adds manual term creation, export, close, and purge.
The file function refuses purge until an Instructor has exported and closed the selected term.

The shared file authentication code is `supabase/functions/_shared/course-auth.js`.
Both `lecture-file` and the new `submission-file` import it.
After review, both functions need publication alongside the migrations and browser code.
The functions use the existing Supabase URL, public key, service-role secret, and allowed-origin settings.
The service-role secret stays in the function environment. It must never enter browser configuration.

The private `submissions` bucket accepts PDF, DOCX, XLSX, PPTX, and ZIP files up to 25 MB.
A student first creates a pending row with `beginSubmission(itemId, file)`.
Only that student's live pending path accepts an upload. Pending rows expire after 15 minutes.
A new begin replaces the same owner's previous pending row.
`submitFile(itemId, file)` handles begin, upload, and finish in order.

The file function checks existence, actual size, and file signatures before finish.
PDFs need `%PDF-` at the start and `%%EOF` within the final 1 KB.
The browser derives MIME types from extensions, including Windows ZIP labels and empty DOCX types.
Server MIME checks remain strict.
Office formats also require matching entries in the ZIP directory. These checks are not antivirus scanning.
A private, service-issued receipt prevents students from bypassing validation through a direct finish RPC.
Only the caller's database transaction commits the submission. Cleanup uses paths returned by database functions.
Failed duplicate finishes cannot delete committed work. Failed old-file cleanup is retried by a later sweep.
Sweeps run on finish and through the Instructor-only `sweepSubmissions()` method.
Downloads first use caller-scoped metadata, then return attachment URLs that expire after 300 seconds.

Late status uses both server start time and the stored object creation time.
Starting after the deadline is late. Creating the object more than five minutes after the deadline is also late.
Confirmation reads `storage.objects.created_at`; browser timestamps cannot change this decision.
A pending upload must also finish before its 15-minute expiry.
A late replacement retains the last on-time path and both of its timestamps.
Group submissions record the members at finish. Later group changes do not change those grading recipients.
Grading and finishing share an owner lock. A waiting finish rejects a file once grading has locked its owner.
Even a zero score before the first submission locks the owner. A current group member’s score locks group submissions.
Grading takes owner locks even when submission rows do not exist. Lock timestamps change only on lock or unlock.
Clear the owner’s scores to unlock. For groups, saved-member and current-member grades can both block uploads.
Unreleasing scores does not unlock submissions.

`classData()` adds `submission_items` and `submissions` alongside the existing fields.
`submission_items` gives students only file/link items. Its fields are `id`, `term_id`, `code`, `title`, `kind`, `mode`,
`group_set_id`, `due_at`, and `locked`. It excludes quiz and attendance items.
Students receive a `locked` boolean instead of the private `graded_at` timestamp, including before any submission exists.
`submissions` contains submitted work and its status; an absent row means no submitted work.
Students receive their own or current group's submissions. Peer UNI snapshots stay hidden.
Staff also receive member snapshots and a `membership_changed` flag.
Scores and comments stay in `grades`, behind the existing release rule.

The browser adapter and synthetic demo share these additional methods:

- `terms()`, `setSessionTimes(week, startsAt, endsAt)`, and `setPreview(uni, termId)`.
- `configureItem(id, { kind, mode, group_set_id, due_at })` and `setFileRelease(id, released, releaseAt)`.
- `beginSubmission`, `uploadSubmissionFile`, `finishSubmission`, `submitFile`, and `submitLink`.
- `submissionUrl(id, 'current' | 'on-time')` and `sweepSubmissions()`.
- `gradeGroup(itemId, groupId, score, comment)`; `saveGrades` also accepts `comment` per entry.

Omitting `comment` from a score update preserves the existing comment. A null score removes the grade row.
Group item settings start without linked sets. The Instructor must link a set before students can submit.
Item kind, mode, and linked set cannot change after completed submissions exist. Pending uploads do not block settings.
The earliest due time among linked group items closes student sign-up.
Students also cannot join or leave a group with submitted work in that set. Instructor moves remain available.
Instructors can switch directly between student previews. Ordinary preview writes remain blocked, including archived-term writes.

Phase A tests use synthetic identities and local databases only. Native PostgreSQL tests cover both required races.
The ordinary Node tests now run one file at a time to reduce resource use.
Hosted upload, replacement, download, and security-advisor checks remain for Claude's review and publication stage.

### Service-role and existing-page contracts

Service-role code must pass `term_id` explicitly. Do not rely on browser defaults or a caller's current-term context.
The submission service passes a trusted `p_term` to `confirm_submission_upload`, `reject_submission_upload`, and `submission_sweep_candidates`.
Confirmation takes the term from caller-visible pending metadata. Sweeps use the term returned by `get_access`.
The ignored private seed names `spring-2027` explicitly and uses `auditor_visible` with `on conflict (term_id, id)`.

Existing page methods were checked against migrations 006–008 in local PostgreSQL tests.
Assignment edits send only title, due, points, description, deliverable, grading, and auditor visibility.
Lecture uploads also send only editable metadata. IDs, term labels, creation dates, and unknown fields are excluded.
Assignment, announcement, and file updates use the current term key. Global identity and allowlist tables remain global.
The contract tests cover existing staff RPC names and arguments, column grants, release rules, and preview switching.
The full browser suite continues to test existing pages with synthetic data.


## Phase B review: explicit file categories

Migration `009_file_category.sql` adds `lecture_files.category`: `in_class` or `notes`, defaulting to `notes`.
It converts existing `In-class:` titles into the `in_class` category and removes the prefix.
A prefix-only title becomes `Untitled file`, preserving the existing nonempty-title constraint.
All existing file paths, release settings, term keys, and Auditor flags remain unchanged.

The existing row-to-JSON projection includes the new column in student and preview snapshots automatically.
The migration grants authenticated callers only category insertion and updates, subject to existing Instructor RLS and preview guards.
There are no new functions or policies. Migrations 006–008 remain unchanged.
The Files upload form now selects the category explicitly. Titles no longer control grouping.

Migration 009 is live in the Phase C base at `01b1e4c`. Phase C leaves migrations 001–009 unchanged.


## Phase C: staff tools and Submit

Phase C starts from `01b1e4c` and merges main at `ba28fbb` during review round 1.
It retains the blue class and red staff menus, updated readings, and Recommended reading labels.
Class tools use the full content width. The header dimensions remain unchanged.
The current course has 16 grading items. Layout tests also verify capacity for a seventeenth item at 1280px and 1440px.
Score columns use compact codes, maxima, and Instructor-only release checkboxes.
Click a grade cell, or press F2, to open its submission panel. Keyboard hints are inside Legend.
The panel shows current and retained on-time work, timestamps, scores, and comments.
**Grade group** copies the score and comment to the members saved with the submission.
Later group changes do not change that list. A dot identifies scores differing from the last recorded group grade.
Migration 010 records group-grade baselines from this release forward. It does not invent baselines for older grades.

Students use **Submit** for M1–M5, FP, and O1–O3. It shares the week-page submission controls and backend checks.
Auditors cannot open Submit. Graded, preview, and archived records retain their existing locks.
Each Submit item occupies one row. The format hint appears once above the list.
Milestone titles link to their corresponding weeks; FP links to Week 6.
O1–O3 have no week association or week link. Due times appear only when set in Settings.

Session, item, group deadline, and file release inputs use New York time, independent of the computer's time zone.
Ambiguous November times and nonexistent March times produce inline errors.
Item kind, mode, and linked group set cannot change after completed submissions exist.
A group item requires a linked set. File categories use the existing migration 009 field.
The old `/materials/files/` address redirects to Settings. File posting offers Weeks 1–6 only.
Gradebook, staff Attendance, and Roster provide a term filter. Older terms are read-only.

### Manual term workflow

1. In **Settings → Term rollover**, enter a new term name and confirm **Open term**.
2. This archives the previous active term. It copies items, instructions, group templates, and six session slots.
3. Dates, release flags, group sign-up, roster, memberships, submissions, attendance, and grades are not carried forward.
4. Replace the new term's roster. Set its dates, due times, group sign-up, and release times separately.
5. For the previous term, select **Export grades and submissions**. Save the downloaded ZIP.
6. The ZIP contains `grades.csv`, `manifest.json`, current submissions, retained on-time submissions, and lecture PDFs.
7. Links, comments, and saved group memberships remain in the manifest. CSV includes removed roster members who still have grades.
8. The browser builds the ZIP and starts its download, then sends completion counts to the function.
   The function verifies those counts against its signed manifest before recording success.
9. Confirm that you saved the export, then select **Close previous term**. This ends student access to that term.
10. To remove its stored files, confirm the separate **Purge stored files** action. Metadata and audit records remain.

There is no automatic close or purge. Storage removal uses the Supabase Storage API and database-selected paths.
A purge failure leaves completion unrecorded. Retrying removes remaining objects and records completion only when none remain.
The service alone can call `record_term_export` and `record_term_purge`; browser roles cannot forge those records.
All term actions deny Graders, Students, Auditors, unlisted users, anonymous users, and Instructor preview.
The function returns CSV, metadata, and file links signed for 300 seconds. It signs URLs in batches of 100.
The browser downloads files, checks sizes, and builds the ZIP with pinned `fflate@0.8.3` from cdn.jsdelivr.net.
Library API reference: [fflate ZIP documentation](https://github.com/101arrowz/fflate#usage).
File bytes and ZIP processing never enter the export function.
The server signs a completion ticket bound to the Instructor, term, file count, byte count, and missing-file list.
The ticket lasts one hour. Altered counts, altered missing lists, expired tickets, and other actors are rejected.
Download, ZIP, and save failures do not send a completion record. Expired file URLs can be renewed.
The browser holds the archive locally; it does not upload the ZIP to another service.

Missing objects appear in `manifest.json` under `missing_files`. Export continues with the available files.
Settings shows the recorded file count, source-file size, and missing-file count next to Close.
The size excludes CSV, metadata, and ZIP overhead. A zero-file export still contains CSV and metadata.
The browser cannot verify that a downloaded file reached your disk. The separate saved-export confirmation remains required.

**One hosted export dry run is required before relying on close/purge.**
After a separately authorized publication, save and open a hosted export with the available files and missing-file list.
Check its recorded counts and size. This local task does not perform that hosted dry run.

In **Settings → Files**, select **List unreferenced files** to inspect unused lecture-notes objects.
Select **Delete listed files**, then confirm, to remove them through the existing caller-scoped cleanup action.
The listing checks references across active, archived, and closed terms. Cleanup checks references again before each deletion.
Preview and all non-Instructor roles are denied. Referenced files always require their normal deletion workflow.
The storage line reports used bytes against 1 GB. It does not create an additional upload quota.
The public term label remains part of the static site configuration and needs review for each new course offering.

Phase C migrations `010_staff_grading.sql` and `011_term_rollover.sql` are live as of main `941e288`.
No hosted changes occur during local tests. Test evidence belongs in `evidence/phase-c/`.


## Phase D: instructor Preparation and Speakers

Migration `012_instructor_prep.sql` remains local. This phase never edits migrations 001–011.
An authorized release must apply 012–014 before publishing these pages. No Edge Function change is needed.

Preparation and Speakers follow Settings in the staff menu. Only Instructors can open them.
Preview hides both tabs and denies their data. Graders, Students, Auditors, unlisted users, and anonymous users cannot read them.

Preparation has six week pages and uses Week 1 at its root address.
Select **Edit**, enter notes, and select **Save**. The status records the last save time.
**View** renders the current draft. It does not save it.
Site navigation, sign-out, and entering preview warn inline about unsaved notes.
Reload, browser navigation, and tab closure use the browser's native unsaved-change warning.
Markdown supports headings, lists, bold, italic, and explicit HTTP/HTTPS/email links.
HTML displays as text. Images, scripts, and embedded media cannot run.

Speakers supports Add, inline Edit, and Delete with an inline confirmation.
Rows sort by Idea, Contacted, Confirmed, Declined, then name. Filtering searches every editable field.
Week is optional. Limits: name 200, affiliation 300, topic 500, contact 2,000, notes 10,000 characters.
Preparation notes allow 50,000 characters per week.

Both tables are global. Opening, closing, or purging a term does not copy or remove them.
Authenticated users receive only SELECT column grants, subject to instructor-only row policies.
The policy helper checks `private.actor_role()='instructor'` and no active preview.
Writes use `save_instructor_note`, `save_speaker`, and `delete_speaker`, each guarded by `require_instructor()`.
Preview triggers provide a second write barrier. Migration 014 removes audit copies of notes and speaker content.
Timestamps and UUIDs remain server-owned. No browser role can write directly to either table.

Local demo notes and three synthetic speakers are available only through the loopback demo.
Real notes and contacts never belong in static page files or JavaScript.
Phase D screenshots and test logs belong in `evidence/phase-d/`.


## Phase E: upload progress, deletion, and compact Speakers

This branch includes main `4536849` and the unshipped Phase D work.
Migration `013_delete_submission.sql` is new. Migrations 001–012 are unchanged in this phase.
A later authorized release needs migrations 012–014, the updated `submission-file` function, and the browser assets.
No database push or deployment occurred during this task.

Week pages and Submit show a thin upload bar under the selected filename.
The percentage comes from actual `XMLHttpRequest.upload` byte events. Demo mode simulates the same callback.
The request uses the student's current token and POSTs to the existing pending Storage path, with upsert disabled.
The file extension supplies the normalized MIME. The 25 MB limit and pending-path Storage policy remain in force.
The finish function still checks file contents and records Storage `created_at` before accepting the submission.
Choose file and Submit remain disabled through upload and finish. An inline failure hides the bar and enables retry.

**Delete submission** is available to the individual owner or current group uploader before the due time.
For group work, the caller must still belong to the group and must have uploaded its current submission.
Other members can replace it. Replacement transfers deletion rights to the new uploader.
An unset due time permits deletion. Any grade, including zero, blocks deletion.
Preview, archived terms, other students, Instructors, Graders, Auditors, and unlisted or anonymous callers cannot delete work.
The control asks for inline confirmation and then returns the status to **Not submitted**.
File and link submissions follow the same rule. The database checks the deadline again after waiting for locks.

`delete_submission` takes the same group-set and owner locks as upload completion and grading.
It re-reads the submission after waiting, cancels that owner's pending replacements, and removes the row atomically.
The audit trigger retains the old row and actor. A fresh upload started after deletion gets a new submission ID.
The function's service client removes current, retained on-time, and cancelled-pending objects selected by SQL.
Browser-supplied paths are ignored. SQL excludes objects still referenced by any submission or pending upload.
As with replacement cleanup, a Storage removal failure leaves deletion committed and returns `cleanup_pending`.
The existing orphan sweep retries these objects during the next valid upload finish or an Instructor sweep.
An upload already streaming when deletion commits may leave an orphan for that sweep, but cannot become a submission.

Speakers uses one compact row for all fields and actions. Optional notes appear underneath in muted text.
Twelve sample speakers, each with a one-line note, fit the 1440 × 900 test viewport, including the footer.
Inline edits and confirmation can expand the selected row. Narrow screens wrap fields without horizontal page scrolling.
Screenshots and logs are in `evidence/phase-e/`.

API references: [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
and [MDN upload progress events](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequestUpload).


## Phase F: grade visibility for staff

Gradebook headers show **Hidden** or **Visible** for every item.
Instructors can select a state control. Making an item visible requires inline confirmation above the grid.
The prompt names the item and covers both scores and comments. Cancel preserves the previous state.
Hiding an item takes effect after the save succeeds. Failed saves preserve the displayed state and allow retry.
Unsaved grid scores block visibility changes, including edits made while confirmation is open.
Grader headers show the same state as read-only text. Archived instructor controls remain disabled.
The existing release RPC and permission rules are unchanged. No new migration is needed.

Hidden score cells use muted gray text and a faint gray background, without italics.
The Legend explains that Hidden keeps scores and comments private; Visible shows each student their own results.
The submission panel states the visibility above Score and Comment.
For hidden items, Graders see that the Instructor must release the item.

The Total column shows the student's **visible total** first, then the total **incl. hidden** in muted text.
Each total independently applies the existing 15-point optional cap and 100-point course cap.
An item filter does not change either course total. Missing grades remain ungraded.
CSV exports retain their existing complete gradebook format and recorded-score totals.

Phase F continues on `phase-d-prep` after merging main `9d127bb`.
Round 1 merges main `9c47771`, removes per-week colors, and keeps main's neutral section boxes and the instructor workspace.
Screenshots and verification logs belong in `evidence/phase-f/`.


## Phase F review, round 1

Migration `014_uploader_delete_and_prep_privacy.sql` is new. Migrations 001–013 remain unchanged.
Group deletion compares the current row's `submitted_by` with the caller after acquiring the existing locks.
If a teammate finishes a replacement first, the previous uploader's waiting deletion is rejected.
The member who uploaded the current submission can delete it before the deadline while it remains ungraded.
The same rule covers group files and links. Individual deletion rules are unchanged.
The existing `choose_group` freeze applies while the submission row exists.
Student snapshots add only an `is_uploader` boolean. They continue to omit uploader identity and membership snapshots.
The week and Submit controls use that boolean. The database remains the authority for every deletion.

Migration 014 also drops `change_audit` on `speakers` and `instructor_notes`.
Their `preview_guard` triggers, role checks, RLS policies, and column grants remain unchanged.
New inserts, edits, and deletes do not copy private content into `audit_log`.
Submission and grade audit records remain enabled. This migration does not purge historical audit records.

Tests check uploader replacement/deletion, group freezes, concurrent replacement, prep role denials, and absence of prep audit rows.
Markdown tests cover JavaScript links, quoted event-handler URLs, and raw image payloads inside bold and headings.
No parser change was needed; these payloads already render as escaped text.
Review evidence belongs in `evidence/phase-f/review-1/`.


## Phase G: calendar, student cards, and group settings

Migration `015_calendar_student_profiles_groups.sql` adds term-scoped private student notes and optional group sign-up notes.
Migrations 001–014 remain unchanged. Phase G was built locally from main `cfbaca9` on `phase-g`.

The public `calendar` Edge Function uses a service client to call the read-only `calendar_data()` projection.
That function selects the active term and explicitly returns only session times and item titles, codes, IDs, and deadlines.
It does not accept a requested term. Anonymous and authenticated clients cannot call the SQL projection directly.
The Edge Function accepts GET/HEAD, caches responses for five minutes, and uses `verify_jwt = false` in `supabase/config.toml`.
It emits New York times with a daylight-saving timezone definition, stable event UIDs, and one-day deadline reminders.
Sessions without configured start/end times and items without deadlines are omitted.
Optional Edge environment variable `CALENDAR_LOCATION` supplies the classroom location. Omit it when no location is set.
The calendar uses the six public week titles; instructor preparation and assignment instructions never enter the feed.
Main `48243f5` removed the calendar links from Course Goals and Course Materials.
The read-only feed remains available at its endpoint. The live design B cards and per-tab menu cache remain in place.
The production endpoint is the configured Supabase URL plus `/functions/v1/calendar`.

Student names open a shared side panel on Gradebook, staff Attendance, and Roster.
The panel shows attendance, every submission item, scores, comments, release states, and both course totals.
A staff-only `student_profile` RPC supplies the course email. Test accounts retain a null email.
The card uses Simon's chosen design B inside the existing grade panel.
Its blue course band, initials block, six attendance stamps, barcode, and work chips follow the supplied mockup.
The 86×104 initials block uses Source Serif. Present, excused, absent, and unrecorded stamps have distinct labeled states.
Each work chip opens that item's existing grade panel. Attendance and Roster use the same grading controls.
The full submission and score record remains available under Submissions and scores below the private note.
The card fits the existing panel at 1280 pixels; its identity block stacks on phones without horizontal page scrolling.
Escape closes it; Up/Down selects adjacent visible students. Arrow keys retain normal behavior inside inputs.
Private note drafts remain in memory when moving between cards until the page refreshes. Save persists the selected note.

Only a real Instructor can select `student_notes`; other roles and preview receive no rows.
Writes use `save_student_note`, instructor checks, an active-term lock, and `preview_guard`.
Direct browser writes have no grants. Notes are limited to 10,000 characters and have no audit trigger.
Archived notes remain readable to Instructors but cannot be edited. Notes never enter class snapshots or exports.
Graders can read the student card but cannot read or save private notes.

Settings contains a Group sign-up settings section for existing sets.
Sign-up notes allow one line of up to 500 characters and appear immediately below the title on Groups.
Add groups accepts 1–100 new empty groups per request and preserves existing groups and memberships.
The RPC locks the set before choosing new numbers; a real PostgreSQL test covers competing additions.
Both controls require a real Instructor and target the active term.
Actual course group notes remain for Claude to set after review.

Verification uses isolated local PostgreSQL/PGlite databases and synthetic browser data.
`ical.js` 2.2.1 is a development-only parser for independent calendar validation.
Screenshots and logs are in `evidence/phase-g/`.
The Phase H handoff confirms that migrations 001–015 are now live. This local task did not deploy Phase G.
Calendar format reference: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).


## Phase H: Assignments pages and student item names

Branch `phase-h` starts at Claude's worktree main `48243f5`.
The week cards, Required tags, new-tab reading links, and removal of calendar links stay intact.

Student week pages, Submit, and Grades use full milestone names and optional-task names.
Staff grading screens and student-card chips retain codes.
Week boxes keep the title, deadline, status chip, group information, Instructions link, and existing upload controls.
Descriptions, Deliverable, and Graded on move to Assignments pages.
Deadlines use New York time and update every minute without refreshing or resetting a chosen upload.

The new class-zone Assignments tab has five milestone pages, Final Project, and Optional Tasks.
The landing URL redirects to Milestone #1; old milestone/week/final-prototype hashes keep their destinations.
Pages render protected Markdown, the short assignment summary, and the same upload component used by weeks.
Markdown supports escaped HTML, headings, lists, bold, italic, safe links in new tabs, and simple pipe tables.
Instructors edit inline with Save, Cancel, saved time, and the Preparation editor's unsaved-change protection.
Multiple Optional Tasks editors retain separate drafts and warn before navigation or sign-out.
Graders and students can read instructions. Auditors receive only shared assignment content and no upload controls.

Migration `016_assignment_pages.sql` adds `assignment_pages`, keyed by term and code, with a 50,000-character limit.
Reads require term access and the linked item's visibility. Students must have access through that term's roster.
Milestones and Final Project use the existing `assignments.auditor_visible` flag.
Optional tasks use the new `grade_items.auditor_visible` flag, false by default; staff SQL can configure it.
Score release does not grant auditor access. The menu catalog contains metadata, never instructions or student records.
Only `save_assignment_page` writes instructions, with instructor checks, preview protection, and an active-term lock.
Direct browser writes and anonymous reads are revoked. Course-content edits enter the audit log.
Archived instructions remain readable under term rules; archived writes fail.
New terms start with empty detailed instructions; this migration does not copy or invent course prose.

Phase H left migrations 001–015 unchanged and tested migration 016 only in isolated local databases.
The Phase I handoff confirms that migrations 001–016 are now live.
No Edge Function deployment is required for Phase H. No remote action was performed here.
Evidence and check logs belong in `evidence/phase-h/`.

## Phase I: Preparation sections and Speakers by week

Branch `phase-i` starts from `origin/main` at `2e90da0`.
Preparation still allows only a real instructor. Student preview and every other role remain denied.
Each week now follows the Library topics and Syllabus exercises, with a muted goal below the page title.
Required and Recommended references show their titles and authors, with links opening in a new tab.
Quiz, exercise, milestone, and logistics notes use normal sections with serif headings and hairlines.
There is no editor on load. Edit or Add notes opens only that section's borderless, growing textarea.
Save and Cancel act on that section. Saving one section leaves other drafts unsaved and keeps their warnings.
Assignments retain their existing editor; all note editors share the navigation and sign-out warning handler.

`_includes/preparation-outline.html` builds public metadata from `weeks.yml`, `library.yml`, and `materials.yml`.
The page's JSON contains only public goals, topic names, exercise names, milestone names, and reading references.
Private notes still load separately through the existing backend and row policies.

`prep-outline-core.js` reads and writes one Markdown body per week in the existing `instructor_notes` table.
Nonempty sections use `## <Section name>` headings followed by a `<!-- preparation-section -->` boundary comment.
That comment distinguishes stored sections from Markdown headings inside a note, including unfinished code examples.
Existing unmarked section headings are accepted. Free-form text, unknown sections, and duplicate sections survive under Other notes.
Retired topics also move to Other notes. Nothing is saved merely by visiting a page.
The existing 50,000-character limit covers the whole serialized week, including headings and comments.
Saved times come from the existing week record; no per-section timestamp or new schema is introduced.

Speakers now has six Library week sections, followed by Unscheduled.
Each speaker keeps the name, affiliation, status, contact, topic, and notes without a table or card.
Add, filter, inline editing, reassignment, and confirmed deletion use the existing backend methods.
The page embeds only public week labels. Speaker records remain instructor-only data.

No migration, RPC, row policy, authentication rule, or Edge Function changed.
Migrations 001–016 remain unchanged. No push, database push, deployment, or hosted-data change occurred.
Screenshots and local check logs are in `evidence/phase-i/`.
