import { courseHandler, canWrite } from '../_shared/course-auth.js';
export function createHandler(createClient, env) {
  return courseHandler(createClient, env, async ({ body, access, userClient, admin, respond }) => {
      if (!body || !['download', 'delete', 'cleanup', 'orphans'].includes(body.action)) return respond(400, { error: 'Unknown file action.' });
      if (body.action !== 'download' && !canWrite(access, ['instructor'])) return respond(403, { error: 'Instructor access required.' });
      if (body.action === 'orphans') {
        const {data,error}=await userClient.rpc('lecture_orphans');
        return error ? respond(409,{error:'Could not list unreferenced files.'}) : respond(200,{files:data});
      }
      let file;
      if (body.action === 'cleanup') {
        if (typeof body.path !== 'string' || !body.path || body.path.length>1024 || /[\x00-\x1f\\]/.test(body.path) || body.path.split('/').some(p=>!p || p==='.' || p==='..')) return respond(400,{error:'Invalid storage path.'});
        if (!/^week-[0-7]\/[0-9a-f-]{36}\.pdf$/.test(body.path)) {
          const {data,error}=await userClient.rpc('lecture_orphans');
          if(error || !data?.some(file=>file.path===body.path))return respond(409,{error:'This path is not an unreferenced file.'});
        }
        const { data: existing, error } = await userClient.from('lecture_files').select('id').eq('storage_path', body.path).maybeSingle();
        if (error || existing) return respond(409, { error: 'This file has metadata. Use Delete in Settings.' });
        file = { storage_path: body.path };
      } else {
        if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return respond(400, { error: 'Invalid file ID.' });
        const { data, error } = await userClient.from('lecture_files').select('id,term_id,storage_path').eq('id', body.id).single();
        // Hidden and missing files return the same response. No storage path comes from the browser.
        if (error || !data) return respond(404, { error: 'File unavailable.' });
        file = data;
        // Staff may read archived files, but Storage deletion must follow the active-term write rule.
        if (body.action === 'delete' && (!access.term_id || file.term_id !== access.term_id)) return respond(403, { error: 'Archived term is read-only.' });
      }
      const adminClient = admin();
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
  });
}
