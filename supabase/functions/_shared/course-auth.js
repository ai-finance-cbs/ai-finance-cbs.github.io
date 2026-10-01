// Both file services validate the session and ask the database for the effective course role.
export const canWrite = (access, roles) => !access.view_as && !access.read_only && roles.includes(access.role);
export function courseHandler(createClient, env, action) {
  const origins = new Set((env('ALLOWED_ORIGINS') || 'https://ai-finance-cbs.github.io,http://127.0.0.1:4173').split(',').map(s => s.trim()));
  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store', Vary:'Origin',
      'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status, body) => new Response(JSON.stringify(body), {status, headers});
    if (origin && !origins.has(origin)) return respond(403,{error:'Origin not allowed.'});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return respond(405,{error:'Use POST.'});
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) return respond(401,{error:'Sign in first.'});
    try {
      const options = {auth:{persistSession:false,autoRefreshToken:false}};
      const userClient = createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{...options,global:{headers:{Authorization:authorization}}});
      const {data:identity,error:authError} = await userClient.auth.getUser(authorization.slice(7));
      if (authError || !identity?.user) return respond(401,{error:'Your session is invalid. Sign in again.'});
      const {data:access,error:accessError} = await userClient.rpc('get_access');
      if (accessError || !access || !['student','instructor','grader','auditor'].includes(access.role)) return respond(403,{error:'You do not have course access.'});
      let body;
      try { body = await request.json(); } catch { return respond(400,{error:'Provide a JSON request.'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(400,{error:'Provide a JSON request.'});
      const admin = () => createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),options);
      return await action({body,access,userClient,admin,respond,actor:identity.user.id});
    } catch { return respond(500,{error:'File operation failed. Check the function configuration and try again.'}); }
  };
}
