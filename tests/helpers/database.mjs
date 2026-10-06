export const bootstrapSQL = `create role service_role nologin bypassrls; create role anon nologin; create role authenticated nologin; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),provider text not null,identity_data jsonb not null);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,created_at timestamptz not null default clock_timestamp()); alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to anon,authenticated;
 -- Match Supabase's direct default grants, not only PostgreSQL's PUBLIC EXECUTE default.
 alter default privileges in schema public grant execute on functions to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant all on sequences to anon,authenticated;`;

export const migrationFiles = [
  '001_course_materials.sql',
  '002_test_accounts.sql',
  '003_class_tools.sql',
  '004_security_hardening.sql',
  '005_announcements.sql',
  '006_terms_and_release.sql',
  '007_submissions.sql',
  '008_grading.sql',
  '009_file_category.sql',
  '010_staff_grading.sql',
  '011_term_rollover.sql',
  '012_instructor_prep.sql',
  '013_delete_submission.sql',
  '014_uploader_delete_and_prep_privacy.sql',
  '015_calendar_student_profiles_groups.sql',
  '016_assignment_pages.sql',
  '017_attendance_excuse.sql',
  '018_canvas_mirror.sql',
  '019_canvas_student_views.sql',
  '020_canvas_staff_attendance.sql',
];
export async function seedGoogleIdentity(db, userId, email) {
  await db.query(
    "insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)",
    [userId, JSON.stringify({ email, email_verified: true })],
  );
}
