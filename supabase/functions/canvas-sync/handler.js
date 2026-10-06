import { CanvasError,canvasClient,collectSnapshot } from './client.js';
const rpc=async(client,name,args={})=>{const r=await client.rpc(name,args);if(r.error)throw new Error(r.error.message);return r.data;};
export function createHandler(createClient,env,dependencies={}) {
  return async request=>{
    const origin=request.headers.get('origin');
    const origins=(env('ALLOWED_ORIGINS')||'https://ai-finance-cbs.github.io,http://127.0.0.1:4173').split(',').map(x=>x.trim());
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
    if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
    const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if (origin && !origins.includes(origin)) return respond(403,{error:'Origin not allowed.'});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (request.method!=='POST') return respond(405,{error:'Use POST.'});
    let run,admin;
    try {
      const body=await request.json();
      if (!body || typeof body!=='object' || Array.isArray(body) || body.term_id!=null && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(body.term_id)) return respond(400,{error:'Provide a valid term.'});
      const options={auth:{persistSession:false,autoRefreshToken:false}};
      admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),options);
      const cron=request.headers.get('x-cron-secret');
      if (cron) {
        if (!env('CRON_SECRET') || cron!==env('CRON_SECRET')) return respond(401,{error:'Invalid scheduler credentials.'});
        run=await rpc(admin,'begin_canvas_sync',{p_term:body.term_id||null});
      } else {
        const authorization=request.headers.get('authorization')||'';
        if (!/^Bearer \S+$/i.test(authorization)) return respond(401,{error:'Sign in first.'});
        const user=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{...options,global:{headers:{Authorization:authorization}}});
        const identity=await user.auth.getUser(authorization.slice(7));
        if (identity.error || !identity.data?.user) return respond(401,{error:'Invalid session.'});
        const access=await rpc(user,'get_access');
        if (access?.role!=='instructor' || access.view_as || access.read_only) return respond(403,{error:'Instructor access required. Preview is read-only.'});
        run=await rpc(user,'request_canvas_sync',{p_term:body.term_id||access.term_id});
      }
      if (!env('CANVAS_TOKEN')) throw new CanvasError('CANVAS_TOKEN is not configured.','auth_failed');
      const snapshot=await collectSnapshot(run.course_id,canvasClient(env('CANVAS_TOKEN'),dependencies));
      const counts=await rpc(admin,'publish_canvas_sync',{p_run:run.id,p_snapshot:snapshot});
      return respond(200,{ok:true,run_id:run.id,counts});
    } catch(error) {
      const message=error instanceof CanvasError ? error.message : 'Canvas sync failed. Check configuration or try again; the previous snapshot is unchanged.';
      if (run) {
        try { await rpc(admin,'fail_canvas_sync',{p_run:run.id,p_status:error.status==='auth_failed'?'auth_failed':'failed',p_error:message}); } catch { /* A dead run expires before the next scheduled attempt. */ }
      }
      return respond(run?502:409,{error:message});
    }
  };
}
