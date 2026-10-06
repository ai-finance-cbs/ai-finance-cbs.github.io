import {refreshCanvasAttendance} from './canvas-attendance-demo.js';
import {canvasId,mappingValues,canvasItems,canvasPresent,canvasPosted,canvasStudentProjection} from './canvas-core.js';
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
    result.assignments=canvasItems(d.items.filter(i=>i.term_id===term)).map((i,n)=>({id:String(100+n),name:i.title,published:true,submission_types:i.kind==='quiz'?['on_paper']:['online_upload'],points_possible:10,due_at:'2027-03-01T14:00:00Z'}));
    result.mappings=canvasItems(d.items.filter(i=>i.term_id===term)).filter(i=>i.site_key!=='Q6').map((i,n)=>({...i,canvas_assignment_id:String(100+n)}));
    result.enrollments=d.roster.filter(r=>r.term_id===term).map((r,n)=>({...r,user_id:String(n+1),login_id:r.uni,section_ids:['10'],match_status:'matched',enrollment_states:['active']}));
    result.enrollments.push({user_id:'99',login_id:'zz9999',name:'Unmatched Canvas student',uni:null,match_status:'unmatched',enrollment_states:['active']});
    result.submissions=result.enrollments.flatMap((u,n)=>result.assignments.map((a,i)=>{
      const quiz=result.mappings.some(m=>m.canvas_assignment_id===a.id && m.kind==='quiz');
      const s={user_id:u.user_id,assignment_id:a.id,workflow_state:n===2?'unsubmitted':'graded',late:n===1,missing:n===2,excused:false,late_policy_status:null,submitted_at:n===2?null:now,seconds_late:n===1?60:0,score:n===2?null:8,grade:n===2?null:'8',posted_at:i===0?now:null,assignment_visible:true,cached_due_at:a.due_at};
      if(quiz)Object.assign(s,{workflow_state:'unsubmitted',score:null,grade:null,submitted_at:null,late:false,missing:false});
      return {...s,quiz_present:canvasPresent(s),posted_visible:canvasPosted(s)};
    }));
    result.groups=[{id:'10',category_id:'1',category_name:'Prototype',name:'Demo group'}];
    result.group_members=result.enrollments.slice(0,2).map(u=>({group_id:'10',user_id:u.user_id,name:u.name}));
    result.runs=[{id:'demo',status:'succeeded',started_at:now,finished_at:now,counts:{enrollments:4},error:null}];
    write(d,term,result);
    return result;
  }
  const write=(d,term,value)=>{d.canvas={...d.canvas,[term]:value};refreshCanvasAttendance(d,term,access()?.email);saveAll(d);};
  return {
    async canvasStudentData(term) {
      const a=access(),d=readAll(),t=d.terms.find(t=>t.id===term);
      if(a?.role!=='student' || !a.uni || !t || t.status==='closed' || (a.view_as && term!==a.term_id)
        || !d.roster.some(r=>r.term_id===term && r.uni===a.uni)) throw new Error('Student access required for this term.');
      const v=initial(d,term),enrollment=v.enrollments.find(e=>e.uni===a.uni && e.match_status==='matched'
        && (e.enrollment_states.includes('active') || t.status==='archived-readable' && e.enrollment_states.includes('completed')));
      return canvasStudentProjection(v,enrollment);
    },
    async canvasData(term) {const d=requireStaff(term);return initial(d,term);},
    async saveCanvasCourse(term,course,confirmReset=false) {
      const d=requireStaff(term,true),v=initial(d,term),id=canvasId(course);
      const now=new Date().toISOString();
      if(v.runs.some(r=>r.status==='running' && Date.parse(r.started_at)>=Date.now()-600000)) throw new Error('Wait for the current sync to finish.');
      for(const r of v.runs)if(r.status==='running')Object.assign(r,{status:'failed',finished_at:now,error:'Sync lease expired; previous snapshot retained.'});
      if(v.course && String(v.course.course_id)!==id) {
        if(confirmReset!==true) throw new Error('Confirm the Canvas course change before clearing copied data. Reload Settings if the course changed in another tab.');
        const counts={};
        for(const key of ['submissions','group_members','mappings','assignments','enrollments','groups']){counts[key==='mappings'?'assignment_map':key]=v[key].length;v[key]=[];}
        v.course.generation=null;v.course.last_synced_at=null;
        v.runs.unshift({id:crypto.randomUUID(),course_id:id,status:'reset',started_at:now,finished_at:now,counts,error:null});
      }
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
      v.submissions=v.submissions.map(s=>({...s,quiz_present:canvasPresent(s),posted_visible:canvasPosted(s)}));
      v.course={...v.course,generation:id,last_synced_at:now};
      v.runs.unshift({id,status:'succeeded',started_at:now,finished_at:now,counts:Object.fromEntries(['assignments','enrollments','submissions','groups','group_members'].map(k=>[k,v[k].length])),error:null});write(d,term,v);return {ok:true};
    },
  };
}
