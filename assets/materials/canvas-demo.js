import {canvasId,mappingValues,canvasItems,canvasPresent,canvasPosted} from './canvas-core.js';
const empty=term=>({term_id:term,course:null,mappings:[],assignments:[],enrollments:[],submissions:[],groups:[],group_members:[],runs:[]});
export function extendCanvas({readAll,saveAll,access}) {
  function requireStaff(term,write=false) {
    const a=access(),d=readAll();
    if (a?.view_as || !['instructor','grader'].includes(a?.role)) throw new Error('Staff access required.');
    if (!d.terms.some(t=>t.id===term)) throw new Error('Term not found.');
    if (write && (a.role!=='instructor' || d.terms.find(t=>t.id===term)?.status!=='active')) throw new Error('Instructor access to the active term is required.');
    return d;
  }
  function initial(d,term) {
    if (d.canvas?.[term]) return structuredClone(d.canvas[term]);
    if (term!=='spring-2027') return empty(term);
    const result=empty(term), now=new Date().toISOString();
    result.course={term_id:term,course_id:'240315',generation:'demo',last_synced_at:now};
    result.assignments=canvasItems(d.items.filter(i=>i.term_id===term)).map((i,n)=>({id:String(100+n),name:i.title,published:true,points_possible:10,due_at:'2027-03-01T14:00:00Z'}));
    result.mappings=canvasItems(d.items.filter(i=>i.term_id===term)).slice(0,2).map((i,n)=>({...i,canvas_assignment_id:String(100+n)}));
    result.enrollments=d.roster.filter(r=>r.term_id===term).map((r,n)=>({...r,user_id:String(n+1),login_id:r.uni,match_status:'matched',enrollment_states:['active']}));
    result.enrollments.push({user_id:'99',login_id:'zz9999',name:'Unmatched Canvas student',uni:null,match_status:'unmatched',enrollment_states:['active']});
    result.submissions=result.enrollments.flatMap((u,n)=>result.assignments.map((a,i)=>{
      const s={user_id:u.user_id,assignment_id:a.id,workflow_state:n===2?'unsubmitted':'graded',late:n===1,missing:n===2,excused:false,late_policy_status:null,submitted_at:n===2?null:now,seconds_late:n===1?60:0,score:n===2?null:8,grade:n===2?null:'8',posted_at:i===0?now:null,assignment_visible:true,cached_due_at:a.due_at};
      return {...s,quiz_present:canvasPresent(s),posted_visible:canvasPosted(s)};
    }));
    result.groups=[{id:'10',category_id:'1',category_name:'Prototype',name:'Demo group'}];
    result.group_members=result.enrollments.slice(0,2).map(u=>({group_id:'10',user_id:u.user_id,name:u.name}));
    result.runs=[{id:'demo',status:'succeeded',started_at:now,finished_at:now,counts:{enrollments:4},error:null}];
    return result;
  }
  const write=(d,term,value)=>{d.canvas={...d.canvas,[term]:value};saveAll(d);};
  return {
    async canvasData(term) {const d=requireStaff(term);return initial(d,term);},
    async saveCanvasCourse(term,course) {
      const d=requireStaff(term,true),v=initial(d,term),id=canvasId(course);
      if (v.course?.generation && String(v.course.course_id)!==id) throw new Error('This term already has a Canvas snapshot. Use a new term for a different course.');
      v.course={...v.course,term_id:term,course_id:id};write(d,term,v);
    },
    async saveCanvasMapping(term,values) {
      const d=requireStaff(term,true),v=initial(d,term),row=mappingValues(values.site_key,values.canvas_assignment_id,values.kind,values.week);
      if (row.canvas_assignment_id && !v.assignments.some(a=>String(a.id)===row.canvas_assignment_id)) throw new Error('Choose an assignment from the latest Canvas sync.');
      if (v.mappings.some(m=>m.site_key!==row.site_key && String(m.canvas_assignment_id)===row.canvas_assignment_id)) throw new Error('This Canvas assignment is already mapped.');
      v.mappings=v.mappings.filter(m=>m.site_key!==row.site_key);if(row.canvas_assignment_id)v.mappings.push(row);write(d,term,v);
    },
    async syncCanvas(term) {
      const d=requireStaff(term,true),v=initial(d,term);
      if (!v.course) throw new Error('Configure the Canvas course first.');
      const now=new Date().toISOString(),id=crypto.randomUUID();
      v.course={...v.course,generation:id,last_synced_at:now};
      v.runs.unshift({id,status:'succeeded',started_at:now,finished_at:now,counts:Object.fromEntries(['assignments','enrollments','submissions','groups','group_members'].map(k=>[k,v[k].length])),error:null});write(d,term,v);return {ok:true};
    },
  };
}
