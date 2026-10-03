import { calendarFeed } from './ical.js';

export function createHandler(createClient, env) {
  return async request => {
    const headers = { 'Access-Control-Allow-Origin':'*' };
    if (request.method === 'OPTIONS') return new Response(null, { headers:{...headers,'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS'} });
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{...headers,Allow:'GET, HEAD, OPTIONS'}});
    try {
      // Do not forward caller credentials or accept a term parameter.
      const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error} = await client.rpc('calendar_data');
      if (error) throw error;
      const body = calendarFeed(data, {location:env('CALENDAR_LOCATION') || ''});
      return new Response(request.method === 'HEAD' ? null : body, {headers:{...headers,
        'Content-Type':'text/calendar; charset=utf-8', 'Cache-Control':'public, max-age=300',
        'Content-Disposition':'inline; filename="b8403.ics"'}});
    } catch {
      return new Response('Calendar unavailable.', {status:503,headers:{...headers,'Cache-Control':'no-store'}});
    }
  };
}
