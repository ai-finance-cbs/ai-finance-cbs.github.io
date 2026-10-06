-- Run manually AFTER migration 018, function deployment, and secret configuration.
-- Store the Edge Function URL as canvas_sync_url and CRON_SECRET as canvas_cron_secret
-- in Supabase Vault through the dashboard. Never put either secret in this file.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname='canvas-sync-active-term' loop perform cron.unschedule(j); end loop;
end $$;
select cron.schedule('canvas-sync-active-term','*/5 * * * *', $job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='canvas_sync_url'),
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='canvas_cron_secret')),
    body:=jsonb_build_object('term_id',c.term_id),timeout_milliseconds:=120000)
  from public.canvas_courses c join public.terms t on t.id=c.term_id where t.status='active';
$job$);
