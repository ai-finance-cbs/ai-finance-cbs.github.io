import { canWrite, toCsv, gradeTotal, gradeCode } from './class-core.js';
// The local fake returns a small, uncompressed archive with the same downloadable contract.
function demoZip(entries) {
  const parts=[],central=[];let offset=0;
  for(const [name,text] of entries) {
    const filename=new TextEncoder().encode(name),bytes=new TextEncoder().encode(text);
    let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+filename.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);local.set(filename,30);
    const dir=new Uint8Array(46+filename.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,filename.length,true);d.setUint32(42,offset,true);dir.set(filename,46);
    parts.push(local,bytes);central.push(dir);offset+=local.length+bytes.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
}
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
    async exportTerm(term) {
      requireInstructor();const d=readAll(),t=d.terms.find(t=>t.id===term);
      if(t?.status!=='archived-readable')throw new Error('Export an archived, readable term.');
      const items=d.items.filter(i=>i.term_id===term),grades=d.grades.filter(g=>g.term_id===term);
      const csv=toCsv([['UNI','Name',...items.map(gradeCode),'Total'],...d.roster.filter(r=>r.term_id===term).map(r=>[r.uni,r.name,...items.map(i=>grades.find(g=>g.uni===r.uni&&g.item_id===i.id)?.score??''),gradeTotal(items,grades.filter(g=>g.uni===r.uni)).total])]);
      const snapshot=Object.fromEntries(['items','grades','submissions','files','roster'].map(key=>[key,d[key].filter(r=>r.term_id===term)]));
      const url=URL.createObjectURL(demoZip([['grades.csv',csv],['synthetic-snapshot.json',JSON.stringify(snapshot,null,2)]]));setTimeout(()=>URL.revokeObjectURL(url),300000);
      t.exported_at=new Date().toISOString();saveAll(d);return {url,filename:`${term}.zip`};
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
