import {canvasPresent,canvasPosted} from './canvas-core.js';
export function demoQuizPresent(d,term,uni,week) {
  const v=d.canvas?.[term],mapping=v?.mappings.find(m=>m.kind==='quiz' && m.week===week);
  if(!mapping)return false;
  const e=v.enrollments.find(e=>e.uni===uni && e.match_status==='matched' && e.enrollment_states.includes('active'));
  return !!e && d.roster.some(r=>r.term_id===term && r.uni===uni) && v.submissions.some(s=>String(s.user_id)===String(e.user_id) && String(s.assignment_id)===String(mapping.canvas_assignment_id) && canvasPresent(s));
}
export function demoQuizPosted(d,term,uni,week) {
  const v=d.canvas?.[term],mapping=v?.mappings.find(m=>m.kind==='quiz' && m.week===week);
  if(!mapping)return false;
  const e=v.enrollments.find(e=>e.uni===uni && e.match_status==='matched' && (e.enrollment_states.includes('active') || d.terms.some(t=>t.id===term && t.status==='archived-readable') && e.enrollment_states.includes('completed')));
  return !!e && v.assignments.some(a=>String(a.id)===String(mapping.canvas_assignment_id) && a.published) && d.roster.some(r=>r.term_id===term && r.uni===uni) && v.submissions.some(s=>String(s.user_id)===String(e.user_id) && String(s.assignment_id)===String(mapping.canvas_assignment_id) && canvasPosted(s));
}
export function refreshCanvasAttendance(d,term,actor) {
  if(!d.terms.some(t=>t.id===term && t.status==='active'))return;
  const mappings=d.canvas[term].mappings.filter(m=>m.kind==='quiz'),weeks=new Set(mappings.map(m=>m.week));
  const keys=new Map(d.attendance.filter(a=>a.term_id===term && (a.canvas_derived || weeks.has(a.week))).map(a=>[`${a.uni}:${a.week}`,{uni:a.uni,week:a.week}]));
  for(const r of d.roster.filter(r=>r.term_id===term))for(const m of mappings)keys.set(`${r.uni}:${m.week}`,{uni:r.uni,week:m.week});
  for(const {uni,week} of keys.values()) {
    const old=d.attendance.find(a=>a.term_id===term && a.uni===uni && a.week===week);
    let row=old;
    if(demoQuizPresent(d,term,uni,week))row={...old,term_id:term,uni,week,status:'present',source_quiz:week,manual_override:false,canvas_derived:true,excuse_reason:null,excused_at:null,excused_by:null};
    else if(old?.status!=='excused' && (old?.canvas_derived || weeks.has(week) && old?.source_quiz))row=null;
    if(JSON.stringify(old || null)===JSON.stringify(row || null))continue;
    d.attendance=d.attendance.filter(a=>a!==old);if(row)d.attendance.push(row);
    d.attendance_audit ||= [];d.attendance_audit.push({term_id:term,actor_email:actor,changed_at:new Date().toISOString(),old_row:old || null,new_row:row || null});
  }
}

export function studentAttendance(d,uni) {
  const rows=d.attendance.filter(a=>a.uni===uni),mappings=d.canvas?.[d.term_id]?.mappings.filter(m=>m.kind==='quiz') || [];
  const weeks=new Set([...rows.map(a=>a.week),...mappings.map(m=>m.week)]);
  return [...weeks].sort((a,b)=>a-b).flatMap(week=>{
    const row=rows.find(a=>a.week===week),mapped=mappings.some(m=>m.week===week);
    const posted=demoQuizPosted(d,d.term_id,uni,week);
    const pending=(mapped || row?.canvas_derived) && !posted && row?.status!=='excused';
    if(!row && !pending)return [];
    const released=row?.source_quiz && (mapped ? posted : d.items.some(i=>i.quiz_week===row.source_quiz && i.released));
    return [{uni,week,status:pending?'pending':row.status,source_quiz:!pending && released ? row.source_quiz : null,
      manual_override:!pending && released ? row.manual_override : null}];
  });
}
