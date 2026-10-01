// Stored ZIP entries need no compression library. Stream one object at a time so the
// archive does not need to fit in the function's memory. Each upload is capped at 25 MB.
const encoder = new TextEncoder();
const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32 = bytes => {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
function header(length,signature) {const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);view.setUint32(0,signature,true);return {bytes,view};}
export async function* zipEntries(entries) {
  const directory=[];let offset=0;
  for await(const {name,bytes} of entries) {
    if(directory.length>=65535 || offset+bytes.length>0xffffffff)throw new Error('Archive exceeds the ZIP size limit.');
    const filename=encoder.encode(name);
    const local=header(30+filename.length,0x04034b50);
    local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);
    const crc=crc32(bytes);
    local.view.setUint32(14,crc,true);local.view.setUint32(18,bytes.length,true);local.view.setUint32(22,bytes.length,true);local.view.setUint16(26,filename.length,true);local.bytes.set(filename,30);
    const central=header(46+filename.length,0x02014b50);
    central.view.setUint16(4,20,true);central.view.setUint16(6,20,true);central.view.setUint16(8,0x800,true);
    central.view.setUint32(16,crc,true);central.view.setUint32(20,bytes.length,true);central.view.setUint32(24,bytes.length,true);central.view.setUint16(28,filename.length,true);central.view.setUint32(42,offset,true);central.bytes.set(filename,46);
    directory.push(central.bytes);offset+=local.bytes.length+bytes.length;
    yield local.bytes;yield bytes;
  }
  const start=offset;
  for(const bytes of directory){offset+=bytes.length;yield bytes;}
  const end=header(22,0x06054b50);
  end.view.setUint16(8,directory.length,true);end.view.setUint16(10,directory.length,true);end.view.setUint32(12,offset-start,true);end.view.setUint32(16,start,true);yield end.bytes;
}
export function gradesCsv(manifest) {
  const items=manifest.items;
  const csv=rows=>rows.map(row=>row.map(value=>{let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
  const roster = new Map(manifest.roster.map(r => [r.uni,r]));
  for (const grade of manifest.grades) if (!roster.has(grade.uni)) roster.set(grade.uni,{uni:grade.uni,name:''});
  return csv([['UNI','Name',...items.flatMap(i=>[i.code,`${i.code} comment`]),'Optional capped','Total'],...[...roster.values()].map(r=>{
    const grades=manifest.grades.filter(g=>g.uni===r.uni);let core=0,optional=0;
    for(const item of items){const score=Number(grades.find(g=>g.item_id===item.id)?.score || 0);if(item.optional)optional+=score;else core+=score;}
    return [r.uni,r.name,...items.flatMap(i=>{const g=grades.find(g=>g.item_id===i.id);return [g?.score,g?.comment];}),Math.min(15,optional),Math.min(100,core+Math.min(15,optional))];
  })]);
}
const safeName = value => String(value).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180);
export function exportStream(manifest,service,term) {
  let fileCount=0,byteCount=0;
  async function* entries() {
    yield {name:'grades.csv',bytes:encoder.encode(gradesCsv(manifest))};
    // Links, both timestamps, group snapshots, and comments remain reviewable after file purge.
    yield {name:'manifest.json',bytes:encoder.encode(JSON.stringify(manifest,null,2))};
    const files=[];
    for(const s of manifest.submissions) {
      const item=manifest.items.find(i=>i.id===s.item_id);
      const folder=`submissions/${safeName(item?.code || s.item_id)}/${safeName(s.owner_uni || s.group_id)}`;
      if(s.storage_path)files.push({bucket:'submissions',path:s.storage_path,name:`${folder}/current-${safeName(s.file_name)}`});
      if(s.on_time_path)files.push({bucket:'submissions',path:s.on_time_path,name:`${folder}/on-time-${safeName(s.on_time_path.split('/').at(-1))}`});
    }
    for(const f of manifest.files)files.push({bucket:'lecture-notes',path:f.storage_path,name:`lecture-notes/week-${f.week}/${safeName(f.id)}-${safeName(f.title)}.pdf`});
    for(const file of files) {
      const {data,error}=await service.storage.from(file.bucket).download(file.path);
      if(error || !data)throw new Error('Export could not read a stored file. No export was recorded.');
      const bytes=new Uint8Array(await data.arrayBuffer());fileCount++;byteCount+=bytes.length;
      yield {name:file.name,bytes};
    }
  }
  async function* complete() {
    yield* zipEntries(entries());
    const {error}=await service.rpc('record_term_export',{p_term:term,p_files:fileCount,p_bytes:byteCount});
    if(error)throw new Error('Export could not be recorded. Retry before closing the term.');
  }
  const iterator=complete();
  return new ReadableStream({
    async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},
    async cancel(){await iterator.return();},
  });
}
