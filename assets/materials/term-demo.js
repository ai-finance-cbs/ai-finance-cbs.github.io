import { canWrite, toCsv, gradeTotal, gradeCode } from './class-core.js';
import { exportTermArchive } from './term-export.js';
export function extendTerms({readAll,saveAll,access}) {
  const requireInstructor=()=>{const a=access();if(!canWrite(a)||a.role!=='instructor')throw new Error('Instructor access required. Preview is read-only.');};
  return {
    async staffOverview() {
      requireInstructor();const d=readAll();return {terms:d.terms,storage_bytes:d.files.reduce((n,f)=>n+(f.file_size||0),0)+d.submissions.reduce((n,s)=>n+(s.file_size||0),0),storage_limit:1073741824};
    },
    async openTerm(name) {
      requireInstructor();const d=readAll(),old=d.terms.find(t=>t.status==='active');
      const id=name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(!id || id.length>40 || name.length>100)throw new Error('Enter a short, distinct term name.');
      if(d.terms.some(t=>t.id===id))throw new Error('This term already exists.');
      old.status='archived-readable';d.terms.push({id,title:name.trim(),status:'active'});
      for(const key of ['sets','groups','assignments','sessions'])for(const row of d[key].filter(r=>r.term_id===old.id)) {
        const fresh={...row,term_id:id};
        if(key==='sets')Object.assign(fresh,{is_open:false,deadline:null});
        if(key==='assignments')fresh.due='TBA';
        if(key==='sessions')Object.assign(fresh,{date:null,starts_at:null,ends_at:null});
        d[key].push(fresh);
      }
      let next=Math.max(...d.items.map(i=>i.id))+1;
      d.items.push(...d.items.filter(i=>i.term_id===old.id).map(i=>({...i,id:next++,term_id:id,released:false,due_at:null})));
      saveAll(d);return id;
    },
    async exportTerm(term, progress) {
      requireInstructor();const d=readAll(),t=d.terms.find(t=>t.id===term);
      if(t?.status!=='archived-readable')throw new Error('Export an archived, readable term.');
      const items=d.items.filter(i=>i.term_id===term),grades=d.grades.filter(g=>g.term_id===term);
      const csv=toCsv([['UNI','Name',...items.map(gradeCode),'Total'],...d.roster.filter(r=>r.term_id===term).map(r=>[r.uni,r.name,...items.map(i=>grades.find(g=>g.uni===r.uni&&g.item_id===i.id)?.score??''),gradeTotal(items,grades.filter(g=>g.uni===r.uni)).total])]);
      const metadata=Object.fromEntries(['items','grades','submissions','files','roster'].map(key=>[key,d[key].filter(r=>r.term_id===term).map(({data,on_time_data,...row})=>row)]));
      metadata.missing_files=[];const files=[];
      const add=async(bucket,path,name,data)=>{if(!path)return;const entry={bucket,path,name};if(!data)metadata.missing_files.push(entry);else files.push({...entry,url:data,size:(await (await fetch(data)).blob()).size});};
      for(const row of d.submissions.filter(r=>r.term_id===term)) {
        await add('submissions',row.storage_path,`submissions/${row.id}/current-${row.file_name}`,row.data);
        await add('submissions',row.on_time_path,`submissions/${row.id}/on-time-file`,row.on_time_data);
      }
      for(const row of d.files.filter(r=>r.term_id===term))await add('lecture-notes',row.storage_path,`lecture-notes/${row.id}.pdf`,row.data);
      const manifest={csv,metadata,files,file_count:files.length,byte_count:files.reduce((n,f)=>n+f.size,0),ticket:'synthetic'};
      return exportTermArchive(term,async body=>{
        requireInstructor();if(body.action==='export')return manifest;
        if(body.file_count!==manifest.file_count || body.byte_count!==manifest.byte_count)throw new Error('Export counts do not match.');
        const latest=readAll(),termRow=latest.terms.find(t=>t.id===term);
        if(termRow.status!=='archived-readable')throw new Error('Term is not available for export.');
        Object.assign(termRow,{exported_at:new Date().toISOString(),file_count:body.file_count,byte_count:body.byte_count,missing_files:metadata.missing_files});saveAll(latest);
        return {ok:true};
      },{progress});
    },
    async lectureOrphans() { requireInstructor();return readAll().orphan_files || []; },
    async cleanupLectureOrphan(path) {
      requireInstructor();const d=readAll();
      if(d.files.some(f=>f.storage_path===path))throw new Error('This file has metadata. Use Delete in Settings.');
      d.orphan_files=(d.orphan_files || []).filter(f=>f.path!==path);saveAll(d);
    },
    async closePreviousTerm(term) {
      requireInstructor();const d=readAll(),t=d.terms.find(t=>t.id===term);
      if(t?.status!=='archived-readable')throw new Error('Choose an archived, readable term.');
      if(!t.exported_at)throw new Error('Download the term export before closing access.');
      t.status='closed';saveAll(d);
    },
    async purgeTerm(term) {
      requireInstructor();const d=readAll(),t=d.terms.find(t=>t.id===term);
      if(t?.status!=='closed'||!t.exported_at)throw new Error('Export and close the term before purging files.');
      for(const key of ['files','submissions','pending_uploads'])for(const row of d[key].filter(r=>r.term_id===term)){delete row.data;delete row.on_time_data;}
      t.purged_at=new Date().toISOString();saveAll(d);return {removed:0};
    },
  };
}
