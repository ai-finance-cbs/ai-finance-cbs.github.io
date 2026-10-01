---
layout: null
---
// Only public Supabase credentials belong in this file.
window.COURSE_MATERIALS = Object.freeze({
  url: {{ site.supabase_url | default: '' | jsonify }},
  key: {{ site.supabase_publishable_key | default: '' | jsonify }},
  googleClientId: {{ site.google_client_id | default: '' | jsonify }},
  base: {{ site.baseurl | default: '' | jsonify }}
});
