import { prepareExport, verifyExport } from '../_shared/term-export.js';
import { courseHandler, canWrite } from '../_shared/course-auth.js';
import { validSubmissionBytes, MAX_BYTES } from '../_shared/submission-files.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_FIELDS='id,term_id,item_id,owner_uni,group_id,uploader_id,storage_path,file_name,file_size,mime_type,started_at,expires_at';
export function createHandler(createClient, env) {
  return courseHandler(createClient,env,async ({body,access,userClient,admin,respond,actor}) => {
    if (!['finish','download','sweep','purge','export','record'].includes(body.action)) return respond(400,{error:'Unknown file action.'});
    if (body.action==='download') {
      if (!['student','grader','instructor'].includes(access.role)) return respond(403,{error:'Submission access required.'});
      if (!UUID.test(body.id || '')) return respond(400,{error:'Invalid submission ID.'});
      const {data:row,error}=await userClient.from('submissions').select('id,storage_path,on_time_path,file_name').eq('id',body.id).single();
      if (error || !row) return respond(404,{error:'Submission unavailable.'});
      const path=body.version==='on-time' ? row.on_time_path : row.storage_path;
      if (!path) return respond(404,{error:'File unavailable.'});
      const {data,error:signError}=await admin().storage.from('submissions').createSignedUrl(path,300,{download:true});
      if (signError || !data) return respond(502,{error:'Could not prepare the file. Try again.'});
      return respond(200,{url:data.signedUrl,expiresIn:300});
    }
    if (['export','record','purge'].includes(body.action)) {
      if (!canWrite(access,['instructor'])) return respond(403,{error:'Instructor access required.'});
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(body.term_id || '')) return respond(400,{error:'Choose a valid term.'});
      const name=body.action==='purge'?'term_purge_manifest':'term_export_manifest';
      const {data:manifest,error}=await userClient.rpc(name,{p_term:body.term_id});
      if(error || !manifest)return respond(409,{error:error?.message || 'Term operation is not authorized.'});
      const service=admin();
      if(body.action==='export') {
        try { return respond(200,await prepareExport(manifest,service,env('SUPABASE_SERVICE_ROLE_KEY'),actor)); }
        catch(error) { return respond(502,{error:error.message}); }
      }
      if(body.action==='record') {
        try { await verifyExport(body,env('SUPABASE_SERVICE_ROLE_KEY'),actor); }
        catch(error) { return respond(409,{error:error.message}); }
        const {error}=await service.rpc('record_term_export',{p_term:body.term_id,p_files:body.file_count,p_bytes:body.byte_count,p_missing:body.missing_files});
        return error ? respond(409,{error:'Export could not be recorded. Retry before closing.'}) : respond(200,{ok:true});
      }
      for(const bucket of ['submissions','lecture-notes']) {
        const paths=manifest.objects.filter(o=>o.bucket===bucket).map(o=>o.path);
        for(let i=0;i<paths.length;i+=100)if((await service.storage.from(bucket).remove(paths.slice(i,i+100))).error)
          return respond(502,{error:'Purge stopped before completion. Retry to remove remaining files.'});
      }
      const {error:recordError}=await service.rpc('record_term_purge',{p_term:manifest.term_id});
      if(recordError)return respond(409,{error:'Purge could not be confirmed. Retry.'});
      return respond(200,{removed:manifest.objects.length});
    }
    if (body.action==='sweep') {
      if (!canWrite(access,['instructor'])) return respond(403,{error:'Instructor access required.'});
      const service=admin();
      const {data:paths,error}=await service.rpc('submission_sweep_candidates',{p_term:access.term_id});
      if (error) return respond(502,{error:'Could not find expired uploads.'});
      if (paths?.length && (await service.storage.from('submissions').remove(paths)).error) return respond(502,{error:'Could not remove expired uploads. Try again.'});
      return respond(200,{removed:paths?.length || 0});
    }
    if (!canWrite(access,['student'])) return respond(403,{error:'Active student access required. Preview is read-only.'});
    if (!UUID.test(body.pending_id || '')) return respond(400,{error:'Invalid pending upload ID.'});
    const {data:pending,error:pendingError}=await userClient.from('pending_uploads').select(PENDING_FIELDS).eq('id',body.pending_id).single();
    if (pendingError || !pending) return respond(404,{error:'Pending upload unavailable.'});
    const service=admin(), bucket=service.storage.from('submissions');
    const discard = async () => {
      const {data:paths,error}=await service.rpc('reject_submission_upload',{p_term:pending.term_id,p_pending:pending.id});
      if (error) return error;
      return paths?.length ? (await bucket.remove(paths)).error : null;
    };
    // Sweep only paths returned by SQL. Browser-supplied paths are never used.
    const {data:expired,error:sweepError}=await service.rpc('submission_sweep_candidates',{p_term:access.term_id});
    if (sweepError || (expired?.length && (await bucket.remove(expired)).error)) return respond(502,{error:'Could not clean expired uploads. Try again.'});
    if (new Date(pending.expires_at).getTime()<=Date.now()) return respond(409,{error:'Pending upload expired.'});
    const {data:file,error:downloadError}=await bucket.download(pending.storage_path);
    if (downloadError || !file) return respond(409,{error:'Upload the file before finishing.'});
    if (file.size>MAX_BYTES || file.size!==Number(pending.file_size) || !validSubmissionBytes(new Uint8Array(await file.arrayBuffer()),pending.file_name,pending.mime_type)) {
      const error=await discard();
      return respond(error ? 502 : 400,{error:error ? 'File rejected; cleanup failed. Try again.' : 'File contents do not match the allowed type or size. Upload a valid file.'});
    }
    const {data:receipt,error:verifyError}=await service.rpc('confirm_submission_upload',{p_term:pending.term_id,p_pending:pending.id,p_size:file.size,p_type:pending.mime_type});
    if (verifyError || !receipt) return respond(409,{error:'Pending upload expired or was replaced. Start again.'});
    const {data:result,error:finishError}=await userClient.rpc('finish_submission',{p_pending:pending.id,p_receipt:receipt});
    if (finishError) {
      // SQL excludes committed files, including a concurrent successful finish of this same upload.
      const error=await discard();
      return respond(error ? 502 : 409,{error:error ? 'Finish failed; cleanup failed. Try again.' : finishError.message});
    }
    const paths=result?.replaced_paths || [];
    const cleanupError=paths.length ? (await bucket.remove(paths)).error : null;
    // A committed submission stays successful. A later sweep retries any failed old-object deletion.
    return respond(200,{submission:result.submission,cleanup_pending:!!cleanupError});
  });
}
