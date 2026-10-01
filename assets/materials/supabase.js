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
  return {
    demo: false,
    onSignOut(callback) {
      // Defer work until the SDK releases its authentication lock.
      return client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') setTimeout(callback, 0);
      });
    },
    async getAccess() {
      const session = checked(await client.auth.getSession());
      if (!session.session) return null;
      const { user } = checked(await client.auth.getUser());
      if (!user || !isColumbiaEmail(user.email || '') || !user.email_confirmed_at || user.app_metadata.provider !== 'google') {
        await client.auth.signOut(); throw new Error('Use a Columbia Google account ending in @columbia.edu or @gsb.columbia.edu.');
      }
      // Database checks repeat the email, provider, roster, and allowlist checks.
      return checked(await client.rpc('get_access'));
    },
    async signIn(redirectTo) { checked(await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } })); },
    // Google's own sign-in window (shows the course site's name) hands back an ID token.
    async signInWithGoogleToken(token, nonce) { checked(await client.auth.signInWithIdToken({ provider: 'google', token, nonce })); },
    async signOut() { checked(await client.auth.signOut()); },
    async claimUni(value) { return checked(await client.rpc('claim_uni', { proposed_uni: value })); },
    async assignments() { return checked(await client.from('assignments').select('*').order('id')); },
    async files() { return checked(await client.from('lecture_files').select('*').order('created_at')); },
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
    async setFileVisibility(id, observer_visible) { checked(await client.from('lecture_files').update({ observer_visible }).eq('id', id)); },
    async deleteFile(id) { await fileAction({ action: 'delete', id }); },
    async fileUrl(id) { return (await fileAction({ action: 'download', id })).url; },
  };
}
