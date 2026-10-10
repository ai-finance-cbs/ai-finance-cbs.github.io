import { assignmentBody } from './assignment-core.js';
import { noteValues, speakerValues } from './prep-core.js';
import { exportTermArchive } from './term-export.js';
import { isColumbiaEmail } from './core.js';
async function loadClient() {
  if (window.supabase) return window.supabase;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = resolve; script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    document.head.append(script);
  });
  return window.supabase;
}
function checked(result) { if (result.error) throw result.error; return result.data; }
export async function createBackend(config) {
  const { createClient } = await loadClient();
  const client = createClient(config.url, config.key, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
  async function fileAction(body, service = 'lecture-file') {
    const { data, error } = await client.functions.invoke(service, { body });
    if (error) {
      let detail;
      try { detail = await error.context?.json(); } catch { /* A failed gateway may not return JSON. */ }
      throw new Error(detail?.error || `File service is unavailable. Check the ${service} function in Supabase.`);
    }
    return data;
  }
  let access = null;
  const rpc = async (name, args = {}) => checked(await client.rpc(name, args));
  const classData = (term = access?.term_id) => access?.view_as ? rpc('view_as_student', { target_uni: access.view_as.uni }) : rpc('class_data', { p_term: term || null });
  return {
    demo: false,
    classData,
    async canvasStudentData(term) { return rpc('canvas_student_data', {p_term:term}); },
    async canvasData(term) { return rpc('canvas_staff_data', {p_term:term}); },
    async saveCanvasCourse(term, course, confirmReset=false) { return rpc('save_canvas_course', {p_term:term,p_course:course,p_confirm_reset:confirmReset}); },
    async saveCanvasMapping(term, row) { return rpc('save_canvas_mapping', {p_term:term,p_key:row.site_key,p_assignment:row.canvas_assignment_id||null,p_kind:row.kind,p_week:row.week}); },
    async syncCanvas(term) { return fileAction({term_id:term}, 'canvas-sync'); },
    async assignmentCatalog(term) { return rpc('assignment_catalog', { p_term:term }); },
    async myTaskMap(term) { return rpc('my_task_map', {p_term:term}); },
    async taskMapClass(term) { return rpc('task_map_class', {p_term:term}); },
    async saveTaskMap(term, payload, submit) { return rpc('save_task_map', {p_term:term,p_payload:payload,p_submit:submit}); },
    async assignmentPages(term, codes) {
      return checked(await client.from('assignment_pages').select('term_id,code,body_md,updated_at').eq('term_id',term).in('code',codes));
    },
    async saveAssignmentPage(term, code, body) {
      assignmentBody(code, body); return rpc('save_assignment_page', { p_term:term,p_code:code,p_body:body });
    },
    async studentProfile(term, uni) { return rpc('student_profile', {p_term:term,p_uni:uni}); },
    async studentNote(term, uni) {
      return checked(await client.from('student_notes').select('term_id,uni,body,updated_at').eq('term_id',term).eq('uni',uni).maybeSingle()) || {term_id:term,uni,body:'',updated_at:null};
    },
    async saveStudentNote(term, uni, body) { return rpc('save_student_note', {p_term:term,p_uni:uni,p_body:body}); },
    async instructorNote(week) {
      return checked(await client.from('instructor_notes').select('week,body,updated_at').eq('week', week).maybeSingle()) || { week, body:'', updated_at:null };
    },
    async saveInstructorNote(week, body) { noteValues(week, body); return rpc('save_instructor_note', { p_week:week, p_body:body }); },
    async speakers() { return checked(await client.from('speakers').select('id,name,affiliation,topic,week,status,contact,notes,created_at,updated_at')); },
    async saveSpeaker(row) {
      const values = speakerValues(row);
      return rpc('save_speaker', { p_id:row.id || null, ...Object.fromEntries(Object.entries(values).map(([key,value]) => [`p_${key}`,value])) });
    },
    async deleteSpeaker(id) { return rpc('delete_speaker', { p_id:id }); },
    async sessions() { return checked(await client.from('attendance_sessions').select('*').eq('term_id', access.term_id).order('week')); },
    async announcements() { return checked(await client.from('announcements').select('*').eq('term_id', access.term_id).order('created_at', { ascending: false }).order('id')); },
    async saveAnnouncement(row) {
      const values = { title: row.title, body: row.body };
      const query = row.id ? client.from('announcements').update(values).eq('term_id', access.term_id).eq('id', row.id) : client.from('announcements').insert(values);
      return checked(await query.select('id').single());
    },
    async deleteAnnouncement(id) { return checked(await client.from('announcements').delete().eq('term_id', access.term_id).eq('id', id).select('id').single()); },
    async staffOverview() { return rpc('staff_overview'); },
    async openTerm(name) { return rpc('open_term', { p_name:name }); },
    async closePreviousTerm(term) { return rpc('close_previous_term', { p_term:term }); },
    async purgeTerm(term) { return fileAction({ action:'purge', term_id:term }, 'submission-file'); },
    async exportTerm(term, progress) { return exportTermArchive(term,body=>fileAction(body,'submission-file'),{progress}); },
    async lectureOrphans() { return (await fileAction({action:'orphans'})).files; },
    async cleanupLectureOrphan(path) { return fileAction({action:'cleanup',path}); },
    async terms() { return checked(await client.from('terms').select('*').order('created_at')); },
    async setSessionTimes(week, startsAt, endsAt) { return rpc('set_session_times', { p_week: week, p_start: startsAt, p_end: endsAt }); },
    async submissionUrl(id, version = 'current') { return (await fileAction({ action:'download', id, version }, 'submission-file')).url; },
    async testAccounts() { return rpc('list_test_accounts'); },
    async studentAccounts() { return rpc('list_student_accounts'); },
    async linkStudent(email, uni) { return rpc('link_student_account', { p_email: email, p_uni: uni }); },
    async setPreview(uni, term = null) { access = await rpc('set_student_preview', { target_uni: uni, p_term: term }); return access; },
    async saveAttendance(week, entries) { return rpc('save_attendance', { p_week: week, entries }); },
    onSignOut(callback) {
      // Defer work until the SDK releases its authentication lock.
      return client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') setTimeout(callback, 0);
      });
    },
    async getAccess() {
      const session = checked(await client.auth.getSession());
      if (!session.session) { access = null; return null; }
      const { user } = checked(await client.auth.getUser());
      const refuse = async () => { await client.auth.signOut(); throw new Error('Use a Columbia Google account ending in @columbia.edu or @gsb.columbia.edu.'); };
      if (!user || !user.email_confirmed_at || user.app_metadata.provider !== 'google') await refuse();
      // The database decides who is allowed: Columbia accounts plus a short private list of test accounts.
      const result = await client.rpc('get_access');
      if (result.error) { if (!isColumbiaEmail(user.email || '')) await refuse(); throw result.error; }
      const meta = user.user_metadata || {};
      access = { ...result.data, first_name: meta.given_name || (meta.full_name || meta.name || '').trim().split(/\s+/)[0] || '' }; return access;
    },
    async signIn(redirectTo) { checked(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } })); },
    // Google's own sign-in window (shows the course site's name) hands back an ID token.
    async signInWithGoogleToken(token, nonce) { checked(await client.auth.signInWithIdToken({ provider: 'google', token, nonce })); },
    async signOut() { if (access?.view_as) await rpc('set_student_preview', { target_uni: null }); checked(await client.auth.signOut()); access = null; },
    async assignments() { if (access?.view_as) return (await classData()).assignments; return checked(await client.from('assignments').select('*').eq('term_id', access.term_id).order('id')); },
    async files() { if (access?.view_as) return (await classData()).files; return checked(await client.from('lecture_files').select('*').eq('term_id', access.term_id).order('created_at')); },
    async adminData() {
      const [roster, allowlist] = await Promise.all([client.from('roster').select('*').eq('term_id', access.term_id).order('uni'), client.from('allowlist').select('*').order('email')]);
      return { roster: checked(roster), allowlist: checked(allowlist) };
    },
    async saveAllowlist(row) { checked(await client.from('allowlist').upsert(row)); },
    async removeAllowlist(email) { checked(await client.from('allowlist').delete().eq('email', email)); },
    async saveAssignment(row) { const values = Object.fromEntries(['title','due','points','description','deliverable','grading','auditor_visible'].filter(key => key in row).map(key => [key, row[key]])); checked(await client.from('assignments').update(values).eq('term_id', access.term_id).eq('id', row.id)); },
    async uploadFile(file, fields) {
      const path = `week-${fields.week}/${crypto.randomUUID()}.pdf`;
      checked(await client.storage.from('lecture-notes').upload(path, file, { contentType: 'application/pdf', cacheControl: '0', upsert: false }));
      const result = await client.from('lecture_files').insert({ week:fields.week, title:fields.title, category:fields.category ?? 'notes', auditor_visible:fields.auditor_visible ?? false, ...(fields.released !== undefined ? {released:fields.released} : {}), ...(fields.release_at !== undefined ? {release_at:fields.release_at} : {}), storage_path: path });
      if (result.error) {
        try { await fileAction({ action: 'cleanup', path }); }
        catch { throw new Error(`Upload metadata failed; remove orphan ${path} in Supabase Storage. ${result.error.message}`); }
        throw result.error;
      }
    },
    async setFileRelease(id, released, releaseAt = null) { checked(await client.from('lecture_files').update({ released, release_at:releaseAt }).eq('term_id', access.term_id).eq('id', id)); },
    async setFileVisibility(id, auditor_visible) { checked(await client.from('lecture_files').update({ auditor_visible }).eq('term_id', access.term_id).eq('id', id)); },
    async deleteFile(id) { await fileAction({ action: 'delete', id }); },
    async fileUrl(id) { return (await fileAction({ action: 'download', id })).url; },
  };
}
