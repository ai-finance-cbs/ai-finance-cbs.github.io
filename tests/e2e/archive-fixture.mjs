// Staff tools still read pre-Canvas archives. Seed those records directly; never
// reopen retired submission/group APIs merely to prepare a browser fixture.
export async function installArchiveFixture(page) {
  await page.addInitScript(()=>{
    const key='b8403-demo-state-v3';
    window.seedRoster=rows=>{
      const d=JSON.parse(sessionStorage.getItem(key)),term=d.terms.find(t=>t.status==='active').id;
      d.roster=[...d.roster.filter(r=>r.term_id!==term),...rows.map(r=>({...r,term_id:term}))];
      for(const e of d.canvas?.[term]?.enrollments || []) {const r=rows.find(r=>r.uni===e.uni);if(r)e.name=r.name;}
      sessionStorage.setItem(key,JSON.stringify(d));
    };
    window.seedArchivedGrades=entries=>{
      const d=JSON.parse(sessionStorage.getItem(key)),term=d.terms.find(t=>t.status==='active').id;
      for(const e of entries){d.grades=d.grades.filter(g=>!(g.term_id===term&&g.uni===e.uni&&g.item_id===e.item_id));if(e.score!=null)d.grades.push({...e,term_id:term});}
      sessionStorage.setItem(key,JSON.stringify(d));
    };
    window.seedCanvasScores=async entries=>{
      const d=JSON.parse(sessionStorage.getItem(key)),term=d.terms.find(t=>t.status==='active').id,c=d.canvas[term];
      for(const entry of entries) {
        const item=d.items.find(i=>i.term_id===term&&i.id===entry.item_id),mapping=c.mappings.find(m=>m.site_key===item.code);
        let e=c.enrollments.find(e=>e.uni===entry.uni);
        if(!e){e={user_id:String(Math.max(...c.enrollments.map(e=>Number(e.user_id)))+1),uni:entry.uni,login_id:entry.uni,name:d.roster.find(r=>r.uni===entry.uni)?.name || entry.uni,match_status:'matched',enrollment_states:['active'],section_ids:['10']};c.enrollments.push(e);}
        let row=c.submissions.find(s=>s.user_id===e.user_id&&s.assignment_id===mapping.canvas_assignment_id);
        if(!row){row={user_id:e.user_id,assignment_id:mapping.canvas_assignment_id,assignment_visible:true,workflow_state:'graded',late:false,missing:false,excused:false,late_policy_status:null,submitted_at:null,posted_at:null,cached_due_at:null};c.submissions.push(row);}
        Object.assign(row,{score:entry.score,grade:entry.score==null?null:String(entry.score),quiz_present:entry.score!=null,posted_visible:!!row.posted_at});
      }
      const {refreshCanvasAttendance}=await import('/assets/materials/canvas-attendance-demo.js');refreshCanvasAttendance(d,term,'canvas-fixture');sessionStorage.setItem(key,JSON.stringify(d));
    };
    window.moveArchivedMember=(uni,group_id)=>{
      const d=JSON.parse(sessionStorage.getItem(key));
      d.members=d.members.filter(m=>m.uni!==uni||m.set_id!=='demo-set');
      d.members.push({term_id:'spring-2027',set_id:'demo-set',group_id,uni});sessionStorage.setItem(key,JSON.stringify(d));
    };
    window.seedArchivedWork=rows=>{
      const d=JSON.parse(sessionStorage.getItem(key)),bytes='data:application/pdf;base64,'+btoa('%PDF-1.7\nSynthetic\n%%EOF');
      for(const row of rows){const group=row.group_id || null;d.submissions.push({id:`archive-${row.item_id}`,term_id:'spring-2027',owner_uni:group?null:'ab1234',group_id:group,
        submitted_by:'ab1234',member_unis:group?['ab1234','cd5678']:['ab1234'],storage_path:row.link?null:`archive/${row.item_id}.pdf`,
        file_size:24,file_name:row.link?null:'archive.pdf',data:row.link?null:bytes,started_at:'2027-02-03T14:15:00Z',submitted_at:'2027-02-03T14:15:00Z',late:true,
        on_time_data:row.on_time_path?bytes:null,graded_at:null,...row});}
      sessionStorage.setItem(key,JSON.stringify(d));
    };
  });
}
