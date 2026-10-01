// Shared handler runs in Supabase's server runtime. Tests call this same handler locally.
// User-scoped queries enforce RLS before the server uses its storage key.
export function createHandler(createClient, env) {
  const allowedOrigins = new Set((env('ALLOWED_ORIGINS') || 'https://ai-finance-cbs.github.io,http://127.0.0.1:4173').split(',').map(s => s.trim()));
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.has(origin)) return respond(403, { error: 'Origin not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond(405, { error: 'Use POST.' });
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) return respond(401, { error: 'Sign in first.' });
    try {
      const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: identity, error: authError } = await userClient.auth.getUser(authorization.slice(7));
      if (authError || !identity?.user) return respond(401, { error: 'Your session is invalid. Sign in again.' });
      const { data: access, error: accessError } = await userClient.rpc('get_access');
      if (accessError || !access || access.role === 'unlisted') return respond(403, { error: 'You do not have course access.' });
      let body;
      try { body = await request.json(); } catch { return respond(400, { error: 'Provide a JSON request.' }); }
      if (!body || !['download', 'delete', 'cleanup'].includes(body.action)) return respond(400, { error: 'Unknown file action.' });
      if (body.action !== 'download' && access.role !== 'instructor_ta') return respond(403, { error: 'Instructor access required.' });
      let file;
      if (body.action === 'cleanup') {
        if (typeof body.path !== 'string' || !/^week-[1-6]\/[0-9a-f-]{36}\.pdf$/.test(body.path)) return respond(400, { error: 'Invalid storage path.' });
        const { data: existing, error } = await userClient.from('lecture_files').select('id').eq('storage_path', body.path).maybeSingle();
        if (error || existing) return respond(409, { error: 'This file has metadata. Use Delete in Admin.' });
        file = { storage_path: body.path };
      } else {
        if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return respond(400, { error: 'Invalid file ID.' });
        const { data, error } = await userClient.from('lecture_files').select('id,storage_path').eq('id', body.id).single();
        // Hidden and missing files return the same response. No storage path comes from the browser.
        if (error || !data) return respond(404, { error: 'File unavailable.' });
        file = data;
      }
      const adminClient = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
      const bucket = adminClient.storage.from('lecture-notes');
      if (body.action === 'download') {
        // Ignore caller-supplied expiry. Every download gets exactly five minutes.
        const { data, error } = await bucket.createSignedUrl(file.storage_path, 300, { download: true });
        if (error || !data) return respond(502, { error: 'Could not prepare the PDF. Try again.' });
        return respond(200, { url: data.signedUrl, expiresIn: 300 });
      }
      const { error: removeError } = await bucket.remove([file.storage_path]);
      if (removeError) return respond(502, { error: 'Could not delete the PDF. Try again.' });
      if (body.action === 'delete') {
        const { error } = await userClient.from('lecture_files').delete().eq('id', body.id);
        if (error) return respond(502, { error: 'PDF removed, but its entry remains. Click Delete again to remove the entry.' });
      }
      return respond(200, { ok: true });
    } catch { return respond(500, { error: 'File operation failed. Check the function configuration and try again.' }); }
  };
}
