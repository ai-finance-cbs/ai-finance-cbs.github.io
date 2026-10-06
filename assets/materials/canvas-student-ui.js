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
export function canvasDue(row, tag='p') {
  return row?.due_at ? dueLine(row.due_at,tag) : el(tag,row?.status==='Status unavailable' || !row ? 'Due date unavailable.' : 'No due date', {class:'due-line'});
}
export function canvasSubmissionBlock({data,canvas,access,path},code,controlsOnly=false) {
  const item=data.submission_items.find(i=>i.code===code) || {code};
  const row=canvas?.items.find(i=>i.site_key===code),week=code==='FP'?6:Number(code.slice(1));
  const section=el('section',null,{class:'week-block assignment-section canvas-assignment',
    id:controlsOnly?`assignment-status-${code}`:code==='FP'?'final-prototype':`milestone-${week}`});
  if (!controlsOnly) {
    section.append(el('h2','Milestone'));
    const title=el('h3',null,{class:'milestone-title'});title.append(el('span',itemName(item,data.assignments)),canvasDue(row,'span'));
    section.append(title,el('a','Instructions →',{class:'assignment-instructions-link',href:path(`assignments/${assignmentSlug(code)}`)}));
  }
  if (access.role==='student') section.append(el('p',row?.status || 'Status unavailable',
    {class:'canvas-status','data-milestone-state':'','data-submission-status':'',role:'status'}));
  section.append(courseWorksLink(row,access.role!=='student'),canvasHealth(canvas));
  return section;
}
export function renderCanvasGrades({root,canvas,data}) {
  root.append(canvasHealth(canvas));
  const list=el('div',null,{id:'my-grades',class:'student-grades canvas-grades'});
  for (const row of canvas.items) {
    const item=data.submission_items.find(i=>i.code===row.site_key) || {code:row.site_key,title:row.title || (row.kind==='quiz'?`In-class quiz ${row.week}`:row.kind==='participation'?'Participation and attendance':`Optional task ${row.site_key.slice(1)}`)};
    const section=el('section',null,{class:'student-grade','data-grade-code':row.site_key});
    section.append(el('h2',itemName(item,data.assignments)));
    if(row.kind==='optional')section.append(el('span','Optional task',{class:'optional-task-label'}));
    section.append(el('p',!canvas.available ? 'Status unavailable' : row.posted_visible ?
      (row.score ?? row.grade ?? 'Not posted') + (row.score!=null && row.points_possible!=null ? ` / ${row.points_possible}` : '') : 'Not posted', {class:'grade-score'}));
    if(row.url)section.append(el('a','Open in CourseWorks →',{href:row.url,target:'_blank',rel:'noopener noreferrer'}));
    list.append(section);
  }
  if (!canvas.items.length) list.append(el('p',canvas.available?'No mapped grades yet.':'Status unavailable'));
  root.append(list);
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
