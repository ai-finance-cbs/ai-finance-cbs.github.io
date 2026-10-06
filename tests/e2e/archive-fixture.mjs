// Staff tools still read pre-Canvas archives. Seed those records directly; never
// reopen retired submission/group APIs merely to prepare a browser fixture.
export async function installArchiveFixture(page) {
  await page.addInitScript(()=>{
    const key='b8403-demo-state-v3';
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
