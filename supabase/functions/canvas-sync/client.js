export const HOST = 'https://courseworks2.columbia.edu';
export class CanvasError extends Error {
  constructor(message, status='failed') { super(message); this.status=status; }
}
const id = value => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new CanvasError('Canvas returned an invalid ID.');
  return String(value);
};
const date = value => {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new CanvasError('Canvas returned an invalid date.');
  return new Date(value).toISOString();
};
const number = value => {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CanvasError('Canvas returned an invalid number.');
  return value;
};
const text = value => value == null ? null : String(value).slice(0,500);
export function allowedURL(value) {
  const url=new URL(value,HOST);
  if (url.origin!==HOST || url.username || url.password || !url.pathname.startsWith('/api/v1/')) throw new CanvasError('Canvas returned an unsafe URL.');
  return url.href;
}
export function nextPage(header) {
  if (!header) return null;
  for (const part of header.split(/,(?=\s*<)/)) {
    const match=/^\s*<([^>]+)>\s*;.*?\brel=(?:"([^"]+)"|([^;\s]+))/.exec(part);
    if (!match) throw new CanvasError('Canvas returned an invalid pagination header.');
    if ((match[2]||match[3]).split(' ').includes('next')) return allowedURL(match[1]);
  }
  return null;
}
export function canvasClient(token,{fetch:fetcher=globalThis.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}) {
  const deadline=now()+110000;
  return async function pages(path) {
    let url=allowedURL(path); const out=[],visited=new Set();
    while (url) {
      if (visited.has(url) || visited.size>=500) throw new CanvasError('Canvas pagination did not finish.');
      visited.add(url); let response;
      for (let attempt=0;attempt<4;attempt++) {
        if (now()>deadline) throw new CanvasError('Canvas sync timed out; previous snapshot retained.');
        response=await fetcher(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
        const remaining=response.headers.get('x-rate-limit-remaining');
        const throttle=response.status===429 || response.status===403 &&
          (remaining!=null && Number(remaining)<=0 || /rate limit/i.test(response.statusText) || /rate limit/i.test((await response.clone().text()).slice(0,4096)));
        if (!throttle) break;
        if (attempt===3) throw new CanvasError('Canvas rate limit persisted; try again later.');
        const retry=Number(response.headers.get('retry-after'));
        await sleep(Math.min(5000,Math.max(250,Number.isFinite(retry)&&retry>0?retry*1000:500*2**attempt)));
      }
      if (response.status===401 || response.status===403) throw new CanvasError('Canvas access failed. Replace the token or check course permissions.','auth_failed');
      if (!response.ok) throw new CanvasError(`Canvas request failed (${response.status}); previous snapshot retained.`);
      const rows=await response.json();
      if (!Array.isArray(rows) || rows.some(r=>!r || typeof r!=='object' || Array.isArray(r))) throw new CanvasError('Canvas returned an invalid collection.');
      out.push(...rows); if (out.length>50000) throw new CanvasError('Canvas collection exceeds the sync limit.');
      url=nextPage(response.headers.get('link'));
    }
    return out;
  };
}
// Canvas precedence is individual, then group, then section, then Everyone.
// At equal precedence, the most generous deadline wins; a null deadline means no deadline.
export function effectiveAssignment(assignment,user,groups) {
  const overrides=assignment.overrides || [];
  const tiers=[overrides.filter(o=>o.student_ids?.some(u=>String(u)===user.user_id)),
    overrides.filter(o=>o.group_id && groups.some(g=>g.user_id===user.user_id && g.group_id===String(o.group_id))),
    overrides.filter(o=>o.course_section_id && user.section_ids.includes(String(o.course_section_id)))];
  const matched=tiers.find(rows=>rows.length) || [];
  const dates=matched.filter(o=>Object.hasOwn(o,'due_at')).map(o=>date(o.due_at));
  return {visible:assignment.published && (!assignment.only_visible_to_overrides || matched.length>0),
    due:dates.length ? dates.includes(null) ? null : dates.sort().at(-1) : date(assignment.due_at)};
}
export function normalizeSnapshot(raw) {
  const users=new Map();
  for (const e of raw.enrollments) {
    const user_id=id(e.user_id ?? e.user?.id), login_id=text(e.user?.login_id), existing=users.get(user_id);
    if (existing && existing.login_id!==login_id) throw new CanvasError('Canvas enrollment identities disagree.');
    const row=existing || {user_id,login_id,name:text(e.user?.name)||'Student',enrollment_states:[],section_ids:[]};
    row.enrollment_states=[...new Set([...row.enrollment_states,String(e.enrollment_state)])];
    if (e.course_section_id) row.section_ids=[...new Set([...row.section_ids,id(e.course_section_id)])];
    users.set(user_id,row);
  }
  const groups=raw.groups.map(g=>({id:id(g.id),category_id:id(g.category_id),category_name:text(g.category_name)||'Group set',name:text(g.name)||'Group'}));
  const members=raw.group_members.map(m=>({group_id:id(m.group_id),user_id:id(m.id),name:text(m.name)||'Student'}));
  const assignments=raw.assignments.map(a=>({id:id(a.id),name:text(a.name)||'Assignment',due_at:date(a.due_at),published:a.published===true,
    points_possible:number(a.points_possible),group_category_id:a.group_category_id ? id(a.group_category_id) : null,
    submission_types:a.submission_types || [],only_visible_to_overrides:a.only_visible_to_overrides===true}));
  const submissions=[];
  for (let s of raw.submissions) {
    const user_id=id(s.user_id), assignment_id=id(s.assignment_id), user=users.get(user_id);
    // Canvas's Test Student is not a StudentEnrollment. It cannot establish a site identity.
    if (!user) continue;
    const a=raw.assignments.find(a=>String(a.id)===assignment_id);
    if (!a) throw new CanvasError('Canvas assignments changed during sync. Retry the complete sync.');
    // Canvas sends excused:null (not false) on unsubmitted work; treat null as not excused.
    if (s.excused==null) s={...s,excused:false};
    if (![s.late,s.missing,s.excused].every(v=>typeof v==='boolean') || !['unsubmitted','submitted','graded','pending_review'].includes(s.workflow_state)) throw new CanvasError('Canvas returned invalid submission flags.');
    const effective=effectiveAssignment(a,user,members);
    submissions.push({user_id,assignment_id,workflow_state:s.workflow_state,late:s.late,missing:s.missing,excused:s.excused,
      late_policy_status:text(s.late_policy_status),submitted_at:date(s.submitted_at),seconds_late:number(s.seconds_late) ?? 0,
      score:number(s.score),grade:text(s.grade),posted_at:date(s.posted_at),
      cached_due_at:Object.hasOwn(s,'cached_due_date') ? date(s.cached_due_date) : effective.due,
      assignment_visible:effective.visible && s.assignment_visible!==false});
  }
  for (const [rows,key] of [[assignments,r=>r.id],[submissions,r=>`${r.assignment_id}:${r.user_id}`],[groups,r=>r.id],[members,r=>`${r.group_id}:${r.user_id}`]]) {
    if (new Set(rows.map(key)).size!==rows.length) throw new CanvasError('Canvas returned duplicate records.');
  }
  return {enrollments:[...users.values()],assignments,submissions,groups,group_members:members};
}
export async function collectSnapshot(course,pages) {
  const base=`/api/v1/courses/${id(course)}`;
  const enrollments=await pages(`${base}/enrollments?type[]=StudentEnrollment&per_page=100`);
  const assignments=await pages(`${base}/assignments?override_assignment_dates=false&per_page=100`);
  for (const a of assignments) a.overrides=await pages(`${base}/assignments/${id(a.id)}/overrides?per_page=100`);
  const submissions=await pages(`${base}/students/submissions?student_ids[]=all&include[]=visibility&per_page=100`);
  const categories=await pages(`${base}/group_categories?per_page=100`), groups=[],group_members=[];
  for (const category of categories) {
    const rows=await pages(`/api/v1/group_categories/${id(category.id)}/groups?per_page=100`);
    for (const g of rows) {
      groups.push({...g,category_id:category.id,category_name:category.name});
      const members=await pages(`/api/v1/groups/${id(g.id)}/users?per_page=100`);
      group_members.push(...members.map(m=>({...m,group_id:g.id})));
    }
  }
  return normalizeSnapshot({enrollments,assignments,submissions,groups,group_members});
}
