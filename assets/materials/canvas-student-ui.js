import { CANVAS_HOST, canvasAvailable } from './canvas-core.js';
import { itemName, assignmentSlug } from './assignment-core.js';
import { courseTime } from './week-core.js';
import { dueLine } from './due-ui.js';

const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  return node;
};
export async function loadCanvas(backend, access, term) {
  if (access.role === 'auditor') return null;
  try {
    if (access.role === 'student') return await backend.canvasStudentData(term);
    const data = await backend.canvasData(term);
    return {available:canvasAvailable(data),last_synced_at:data.course?.last_synced_at || null,
      items:data.mappings.map(m => {
        const a=data.assignments.find(a=>String(a.id)===String(m.canvas_assignment_id));
        return {site_key:m.site_key,due_at:a?.due_at || null,
          url:a ? `${CANVAS_HOST}/courses/${data.course.course_id}/assignments/${a.id}` : null};
      }),
      groups:data.groups.map(g=>({...g,members:data.group_members.filter(m=>String(m.group_id)===String(g.id)).map(m=>({name:m.name}))}))};
  } catch {
    // A failed request must not turn an unknown result into Missing or a zero.
    return {available:false,last_synced_at:null,sync_unknown:true,items:[],groups:[]};
  }
}
function updateHealth(node) {
  const date=node.dataset.syncedAt;
  node.textContent=`Last synced: ${date ? courseTime(date) : node.dataset.syncUnknown==='true' ? 'Unavailable' : 'Never'}${date && Date.now()-Date.parse(date)>1800000 ? ' · Updates delayed' : ''}${node.dataset.available==='false' ? ' · Status unavailable' : ''}`;
}
export function canvasHealth(data) {
  const line=el('p',null,{class:'canvas-sync-note','data-canvas-health':'','data-synced-at':data?.last_synced_at || '', 'data-available':String(!!data?.available),'data-sync-unknown':String(!!data?.sync_unknown)});
  updateHealth(line);return line;
}
setInterval(()=>document.querySelectorAll('[data-synced-at]').forEach(updateHealth),60000);

export function courseWorksLink(row, staff=false) {
  if (!row?.url) return el('span','CourseWorks link unavailable.',{class:'upcoming-meta'});
  return el('a',staff ? 'Open in CourseWorks →' : 'Submit on CourseWorks →',
    {href:row.url,target:'_blank',rel:'noopener noreferrer',class:'courseworks-link'});
}
export function statusPill(status='Status unavailable', compact=false) {
  const tone={Done:'submitted',Submitted:'submitted',Late:'late',Missing:'missing',Excused:'neutral'}[status] || 'neutral';
  const label=compact ? {Done:'✓',Submitted:'✓',Excused:'EX','Not yet due':'–','Status unavailable':'?'}[status] || status : status==='Done'?'Submitted ✓':status;
  return el('span',label,{class:`canvas-status-pill status-${tone}${compact?' status-compact':''}`,'data-canvas-status':status,title:status});
}
export function canvasDue(row, tag='p', compact=false) {
  return row?.due_at ? dueLine(row.due_at,tag,compact) : el(tag,row?.status==='Status unavailable' || !row ? 'Due date unavailable.' : 'No due date', {class:'due-line'});
}
export function canvasSubmissionBlock({data,canvas,access,path},code,controlsOnly=false) {
  const item=data.submission_items.find(i=>i.code===code) || {code};
  const row=canvas?.items.find(i=>i.site_key===code),week=code==='FP'?6:Number(code.slice(1));
  const section=el('section',null,{class:'week-block assignment-section canvas-assignment',
    id:controlsOnly?`assignment-status-${code}`:code==='FP'?'final-prototype':`milestone-${week}`});
  if (!controlsOnly) {
    section.append(el('h2','Milestone'));
    const title=el('h3',null,{class:'milestone-title'});title.append(el('span',itemName(item,data.assignments)),' · ',canvasDue(row,'span',true));
    section.append(title);
  }
  if (access.role==='student') {
    const line=el('p',null,{class:'canvas-status','data-milestone-state':'','data-submission-status':'',role:'status'});
    line.append(statusPill(row?.status));section.append(line);
  }
  const links=el('p',null,{class:'canvas-assignment-links'});
  if(!controlsOnly)links.append(el('a','Instructions →',{class:'assignment-instructions-link',href:path(`assignments/${assignmentSlug(code)}`)}),' · ');
  links.append(courseWorksLink(row,access.role!=='student'));section.append(links,canvasHealth(canvas));
  return section;
}
export function renderCanvasGrades({root,canvas,data}) {
  root.append(canvasHealth(canvas));
  const table=el('table',null,{id:'my-grades',class:'canvas-student-grades'}),head=el('thead'),labels=el('tr');
  for(const label of ['Item','Status','Score'])labels.append(el('th',label,{scope:'col'}));
  head.append(labels);table.append(head);
  for(const [label,kinds] of [['Milestones',['milestone','final']],['Quizzes',['quiz']],['Participation',['participation']],['Optional tasks',['optional']]]) {
    const rows=canvas.items.filter(row=>kinds.includes(row.kind));if(!rows.length)continue;
    const body=el('tbody'),group=el('tr',null,{class:'canvas-grade-group'}),heading=el('th',null,{colspan:'3',scope:'colgroup'});
    heading.append(el('h2',label));group.append(heading);body.append(group);
    for (const row of rows) {
      const item=data.submission_items.find(i=>i.code===row.site_key) || {code:row.site_key,title:row.title || (row.kind==='quiz'?`In-class quiz ${row.week}`:row.kind==='participation'?'Participation and attendance':`Optional task ${row.site_key.slice(1)}`)};
      const tr=el('tr',null,{'data-grade-code':row.site_key}),title=el('th',null,{scope:'row'}),status=el('td');
      title.append(row.url ? el('a',itemName(item,data.assignments),{href:row.url,target:'_blank',rel:'noopener noreferrer'}) : document.createTextNode(itemName(item,data.assignments)));
      status.append(statusPill(canvas.available?row.status:'Status unavailable'));
      tr.append(title,status,el('td',!canvas.available ? 'Status unavailable' : row.posted_visible ?
        (row.score ?? row.grade ?? 'Not posted') + (row.score!=null && row.points_possible!=null ? ` / ${row.points_possible}` : '') : 'Not posted', {class:'grade-score'}));
      body.append(tr);
    }
    table.append(body);
  }
  if (!canvas.items.length) root.append(el('p',canvas.available?'No mapped grades yet.':'Status unavailable'));
  else root.append(table);
}
export function renderCanvasGroups({root,canvas,access}) {
  root.append(canvasHealth(canvas));
  if (!canvas.available) {root.append(el('p','Status unavailable'));return;}
  if (!canvas.groups.length) {root.append(el('p',access.role==='student'?'You have no group assigned in CourseWorks.':'No Canvas groups.'));return;}
  const sets=new Map();
  for(const group of canvas.groups) {
    if(!sets.has(group.category_id)) {
      const section=el('section',null,{class:'canvas-group-set'});section.append(el('h2',group.category_name));root.append(section);sets.set(group.category_id,section);
    }
    const section=el('section',null,{class:'canvas-group'});section.append(el('h3',group.name));
    const members=el('ul');for(const member of group.members)members.append(el('li',member.name));
    section.append(members);sets.get(group.category_id).append(section);
  }
}
