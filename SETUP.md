# Set up Course Materials

The public site remains on GitHub Pages. Supabase stores private course data and PDFs.
No Vercel app is needed. No online setup or deployment was performed during this build.

Allow about 30–45 minutes for setup. University Google restrictions may require help from CUIT.

## Preview locally now

1. Open **Terminal** from Applications → Utilities.
2. Paste `cd ~/Github/ai-finance-cbs` and press Return.
3. Paste `npm install` and press Return. Node.js 22 or newer is required for tests.
4. Paste `npm run dev` and press Return. This builds Jekyll and serves the result locally.
5. Open `http://127.0.0.1:4173/?fakeauth=instructor` in your browser.
6. Select **Course Materials**, then **Admin** to try a CSV or PDF upload.
7. Use `?fakeauth=student`, `?fakeauth=observer`, `?fakeauth=unlisted`, or `?fakeauth=gsb` to test other roles.
8. The first-time CBS demo accepts `ab1234`. Demo data stays in the current browser tab.
9. To change roles through the modal, choose **Sign out**, **Log in**, then **Preview role**.
10. To use real sign-in locally, open a new tab without `fakeauth`. Close old demo tabs.
11. If port 4173 is already running, use its existing preview. Rebuild with `npm run build` after changes.

The local build script uses the installed gems in `~/.local/share/jekyll-gems`.
On another computer, install Ruby and Jekyll first. The site needs no Jekyll plugins.
The fake-auth switch only works on `http://127.0.0.1`. It is inert on the live domain.

## Create the Supabase project

1. Open [Supabase](https://supabase.com/dashboard) and sign in using your chosen account.
2. Click **New project**. Create or select an organization.
3. Name the project `B8403 Course Materials`. Choose the free plan and a nearby region.
4. Generate a database password. Save it in your password manager. Click **Create new project**.
5. Wait for the project to become ready.
6. Open **Connect**. Copy the **Project URL** and **Publishable key** into a temporary note.
7. If your project shows legacy keys, the `anon` key is the public key. Do not use `service_role` or a secret key.
8. Open **Authentication → Sign In / Providers → Google**. Leave this page open.
9. Copy the **Callback URL**. It looks like `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.

Supabase's [client setup guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client) identifies the public URL and key.

## Create the Google sign-in client

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector at the top. Click **New Project**.
3. Name it `B8403 Course Materials`. Select your permitted organization, then click **Create**.
4. Open **Google Auth Platform** using the console search bar.
5. Click **Get started** if prompted. Enter `B8403 Course Materials` as the app name.
6. Select your support email. Enter `oh@gsb.columbia.edu` as the contact email where appropriate.
7. Choose an **External** audience if available. This supports both Columbia account domains.
8. Complete the setup and open **Audience**. While testing, add your own Google account under **Test users**.
9. Add any other accounts that will test sign-in while the app remains in Testing status.
10. Open **Data Access → Add or remove scopes**. Include `openid`, `userinfo.email`, and `userinfo.profile`.
11. Open **Clients → Create client**. Select **Web application**.
12. Name the client `B8403 Website`.
13. Under **Authorized JavaScript origins**, add `https://ai-finance-cbs.github.io`.
14. For local real-auth testing, also add `http://127.0.0.1:4173`.
15. Under **Authorized redirect URIs**, paste the Supabase Callback URL from the previous section.
16. Click **Create**. Copy the **Client ID** and **Client secret**.
17. Return to Supabase's **Google** provider page. Enable Google sign-in.
18. Paste the Client ID and Client secret into their fields. Click **Save**.
19. Under Supabase's other providers, disable Email sign-in and anonymous sign-ins. Leave Google enabled.
20. Before inviting the class, change Google's audience publishing status from Testing to Production when permitted.
21. If Columbia blocks client creation or sign-in, ask CUIT to approve the Google OAuth app. Do not bypass university controls.

The Google client secret belongs only in Supabase's provider settings.
Follow the current [Supabase Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google) if menu names differ.

## Allow the return pages

1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://ai-finance-cbs.github.io`.
3. Under **Redirect URLs**, add `https://ai-finance-cbs.github.io/**`.
4. Also add `http://127.0.0.1:4173/**` for local real-auth testing.
5. Click **Save**. These patterns allow Google to return to the page where sign-in began.
6. Keep the scheme, hostname, and port exact. Do not use a wildcard hostname.

Supabase documents its matching rules in [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Install the database and private bucket

1. In Finder, press **Command–Shift–G**. Paste `~/Github/ai-finance-cbs/supabase/migrations/` and press Return.
2. Open `001_course_materials.sql` in a plain text editor. Select all and copy it.
3. In Supabase, click **SQL Editor → New query**. Paste the SQL. Click **Run**.
4. Run this migration once on the new project. It creates the tables, access rules, and private PDF bucket.
5. In Finder, open `~/Github/ai-finance-cbs/supabase/private/seed.sql`.
6. Copy that file into another SQL Editor query. Click **Run**.
7. This inserts the five milestones and Final Prototype. Re-running the seed preserves existing edits.
8. The private seed stays on this computer. It is excluded from Git and the generated site.
9. Open **Storage → lecture-notes**. Confirm the bucket is **Private**. Do not make it public.
10. The bucket allows PDFs up to 20 MB. The file function issues five-minute download links.
11. The migration grants the initial instructor role to `oh@gsb.columbia.edu`.

The Final Prototype source named in the original brief was missing.
The local seed uses the same section from `__archive__/20260928/before-merge/syllabus.html`.
`tools/create-materials-seed.rb` records the exact source paths in the seed header.

## Install the protected file function

1. In Supabase, open **Edge Functions**. Click **Deploy a new function → Via Editor**.
2. Name the function exactly `lecture-file`.
3. Open `~/Github/ai-finance-cbs/supabase/functions/lecture-file/index.ts` in your text editor.
4. Replace the dashboard's `index.ts` contents with that file's contents.
5. In the dashboard editor, add a file named `handler.js` beside `index.ts`.
6. Copy `~/Github/ai-finance-cbs/supabase/functions/lecture-file/handler.js` into that file.
7. Keep JWT verification enabled. This also appears as **Enforce JWT Verification** in function settings.
8. Click **Deploy function**. This is a future setup step; no function was deployed during this build.
9. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` inside the function runtime.
10. These server values stay in Supabase. Never copy the service-role key into `_config.yml` or browser JavaScript.
11. The function permits the course domain and `http://127.0.0.1:4173` by default.
12. If the course domain changes later, add an `ALLOWED_ORIGINS` secret containing the exact allowed origins, separated by commas.
13. Test a download and a deletion after signing in as instructor. Check function logs if either fails.

The function checks the caller's identity and queries file metadata with that caller's RLS permissions.
It then uses its server credential only to sign or delete the authorized object.
Direct browser reads and signing requests are denied, including for instructors.
Every issued download link expires after 300 seconds; a caller cannot request a longer lifetime.

See Supabase's [dashboard function guide](https://supabase.com/docs/guides/functions/quickstart-dashboard) and [function authentication guide](https://supabase.com/docs/guides/functions/auth).

## Connect this site's public credentials

1. In Finder, open `~/Github/ai-finance-cbs/_config.yml` in your text editor.
2. Find `supabase_url: ""`. Paste the Project URL between the quotation marks.
3. Find `supabase_publishable_key: ""`. Paste the Publishable key between the quotation marks.
4. Save the file. These two values may be public because database policies enforce access.
5. Never place the Google client secret, database password, service-role key, or secret key in this repository.
6. In Terminal, run `npm run build` from the site folder.
7. Open a fresh browser tab at `http://127.0.0.1:4173/`. Do not add `fakeauth`.
8. Click **Log in → Continue with Columbia Google**. Choose `oh@gsb.columbia.edu`.
9. Confirm **Instructor / TA** appears. Open **Course Materials → Admin**.
10. Check the real login, upload, download, and sign-out flow before requesting publication.
11. Publication requires a later, separate approval. This build does not push or change the live site.

## Load the class and course files

1. Export the class roster from Canvas's People roster export, where available.
2. If your Canvas view lacks that export, obtain the course CSV through your authorized Canvas administrator.
3. Open **Admin → Class roster**. Choose the CSV. Click **Preview roster**.
4. Check the UNI column and all flagged rows. Numeric SIS User IDs are not treated as UNIs.
5. Select the replacement checkbox only when the preview is correct. Click **Replace roster**.
6. This replaces the whole roster. Removed students lose access on their next database request.
7. Under **TA and observer access**, enter a Columbia email, choose its role, and click **Save access**.
8. Explicit observer entries take precedence over the roster. Observers see only shared items.
9. Under **Lecture PDFs**, choose the week, enter a title, select a PDF, and choose observer visibility.
10. Click **Upload PDF**. Use the sharing and deletion buttons beside uploaded files as needed.
11. Under **Assignment text and access**, open a milestone, edit the fields, and click **Save assignment**.
12. Assignment fields accept plain text. Uploaded text is never interpreted as HTML.
13. First-time CBS students enter their own UNI. Membership is checked against the roster and then saved once.
14. A UNI entry is self-reported. This requested flow does not independently prove ownership of a UNI.
15. For a mistaken UNI, the project owner can open **Table Editor → profiles**, locate the account, and clear its `uni` value.

Signed links are bearer links: a recipient can reuse an issued link until it expires.
The file function fixes the lifetime at 300 seconds. Storage policies block direct browser reads and signing.
RLS determines whether the caller can see the requested file before the function issues its link.
The domain, provider, roster, and role checks still run in Postgres for direct API calls.

## Run the local checks

1. Run `npm install` once.
2. Run `npx playwright install chromium` if Chromium is missing.
3. Run `npm run check` to build the site, run the unit/database tests, and run the browser tests.
4. Open `playwright-report/index.html` to inspect the browser report.
5. Screenshots are in `evidence/materials-20260930/`.
6. Database tests execute the actual migration in local PostgreSQL through PGlite.
7. Those tests simulate Supabase's Auth and Storage tables. They do not replace a hosted Supabase smoke test.
8. Separate function tests check authentication, hidden files, fixed expiry, deletion permissions, and retry behavior.
