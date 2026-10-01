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
  async function fileAction(body) {
    const { data, error } = await client.functions.invoke('lecture-file', { body });
    if (error) {
      let detail;
      try { detail = await error.context?.json(); } catch { /* A failed gateway may not return JSON. */ }
      throw new Error(detail?.error || 'File service is unavailable. Check the lecture-file function in Supabase.');
    }
    return data;
  }
  let access = null;
  const rpc = async (name, args = {}) => checked(await client.rpc(name, args));
  const classData = () => access?.view_as ? rpc('view_as_student', { target_uni: access.view_as.uni }) : rpc('class_data');
  return {
    demo: false,
    classData,
    async testAccounts() { return rpc('list_test_accounts'); },
    async studentAccounts() { return rpc('list_student_accounts'); },
    async linkStudent(email, uni) { return rpc('link_student_account', { p_email: email, p_uni: uni }); },
    async setPreview(uni) { access = await rpc('set_student_preview', { target_uni: uni }); return access; },
    async setSessionDate(week, date) { return rpc('set_session_date', { p_week: week, p_date: date }); },
    async saveAttendance(week, entries) { return rpc('save_attendance', { p_week: week, entries }); },
    async saveGrades(entries) { return rpc('save_grades', { entries }); },
    async releaseItem(id, released) { return rpc('release_grade_item', { p_item: id, p_released: released }); },
    async createSet(f) { return rpc('create_group_set', { p_title: f.title, p_count: f.count, p_max: f.max_size, p_deadline: f.deadline }); },
    async updateSet(id, open, deadline) { return rpc('update_group_set', { p_set: id, p_open: open, p_deadline: deadline }); },
    async chooseGroup(set, group, uni = null) { return rpc('choose_group', { p_set: set, p_group: group, p_uni: uni }); },
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
      access = result.data; return access;
    },
    async signIn(redirectTo) { checked(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } })); },
    // Google's own sign-in window (shows the course site's name) hands back an ID token.
    async signInWithGoogleToken(token, nonce) { checked(await client.auth.signInWithIdToken({ provider: 'google', token, nonce })); },
    async signOut() { if (access?.view_as) await rpc('set_student_preview', { target_uni: null }); checked(await client.auth.signOut()); access = null; },
    async claimUni(value) { return checked(await client.rpc('claim_uni', { proposed_uni: value })); },
    async assignments() { if (access?.view_as) return (await classData()).assignments; return checked(await client.from('assignments').select('*').order('id')); },
    async files() { if (access?.view_as) return (await classData()).files; return checked(await client.from('lecture_files').select('*').order('created_at')); },
    async adminData() {
      const [roster, allowlist] = await Promise.all([client.from('roster').select('*').order('uni'), client.from('allowlist').select('*').order('email')]);
      return { roster: checked(roster), allowlist: checked(allowlist) };
    },
    async replaceRoster(rows) { checked(await client.rpc('replace_roster', { rows })); },
    async saveAllowlist(row) { checked(await client.from('allowlist').upsert(row)); },
    async removeAllowlist(email) { checked(await client.from('allowlist').delete().eq('email', email)); },
    async saveAssignment(row) { checked(await client.from('assignments').update(row).eq('id', row.id)); },
    async uploadFile(file, fields) {
      const path = `week-${fields.week}/${crypto.randomUUID()}.pdf`;
      checked(await client.storage.from('lecture-notes').upload(path, file, { contentType: 'application/pdf', cacheControl: '0', upsert: false }));
      const result = await client.from('lecture_files').insert({ ...fields, storage_path: path });
      if (result.error) {
        try { await fileAction({ action: 'cleanup', path }); }
        catch { throw new Error(`Upload metadata failed; remove orphan ${path} in Supabase Storage. ${result.error.message}`); }
        throw result.error;
      }
    },
    async setFileVisibility(id, auditor_visible) { checked(await client.from('lecture_files').update({ auditor_visible }).eq('id', id)); },
    async deleteFile(id) { await fileAction({ action: 'delete', id }); },
    async fileUrl(id) { return (await fileAction({ action: 'download', id })).url; },
  };
}
