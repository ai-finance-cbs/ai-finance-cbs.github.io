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

const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value))));
const key = secret => crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);

// Only metadata and short-lived URLs leave this function. No file bytes or ZIP work run here.
export async function prepareExport(snapshot, service, secret, actor) {
  const {storage_objects:objects=[], ...metadata} = snapshot;
  const stored=new Map(objects.map(o=>[`${o.bucket}/${o.path}`,o]));
  const candidates=[];
  for(const s of snapshot.submissions) {
    const item=snapshot.items.find(i=>i.id===s.item_id);
    const folder=`submissions/${safeName(item?.code || s.item_id)}/${safeName(s.owner_uni || s.group_id)}`;
    if(s.storage_path)candidates.push({bucket:'submissions',path:s.storage_path,name:`${folder}/current-${safeName(s.file_name)}`});
    if(s.on_time_path)candidates.push({bucket:'submissions',path:s.on_time_path,name:`${folder}/on-time-${safeName(s.on_time_path.split('/').at(-1))}`});
  }
  for(const f of snapshot.files)candidates.push({bucket:'lecture-notes',path:f.storage_path,name:`lecture-notes/week-${f.week}/${safeName(f.id)}-${safeName(f.title)}.pdf`});
  const missing_files=[], files=[];
  for(const file of candidates) {
    const object=stored.get(`${file.bucket}/${file.path}`);
    if(!object)missing_files.push(file);
    else files.push({...file,size:object.size == null ? null : Number(object.size)});
  }
  for(const bucket of ['submissions','lecture-notes']) {
    const selected=files.filter(f=>f.bucket===bucket);
    for(let i=0;i<selected.length;i+=100) {
      const batch=selected.slice(i,i+100);
      const {data,error}=await service.storage.from(bucket).createSignedUrls(batch.map(f=>f.path),300,{download:true});
      if(error || !data)throw new Error('Could not prepare export downloads. Retry.');
      for(const file of batch) {
        const signed=data.find(row=>row.path===file.path);
        if(signed?.error && /not.found|does not exist/i.test(String(signed.error.message || signed.error))) {
          missing_files.push({bucket:file.bucket,path:file.path,name:file.name});
          files.splice(files.indexOf(file),1);
        } else if(!signed?.signedUrl || signed.error)throw new Error('Could not prepare an export file. Retry.');
        else {
          if(!Number.isSafeInteger(file.size) || file.size<0)throw new Error('Stored file size is unavailable. Retry after checking Storage metadata.');
          file.url=signed.signedUrl;
        }
      }
    }
  }
  missing_files.sort((a,b)=>a.name.localeCompare(b.name));
  metadata.missing_files=missing_files;
  const csv=gradesCsv(snapshot), file_count=files.length, byte_count=files.reduce((n,f)=>n+f.size,0);
  const manifest_id=await digest({metadata,csv,files:files.map(({url,...f})=>f)});
  const receipt={term:snapshot.term.id,actor,manifest_id,file_count,byte_count,missing_hash:await digest(missing_files),expires_at:Date.now()+3600000};
  const payload=JSON.stringify(receipt);
  const signature=hex(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(payload)));
  return {csv,metadata,files,file_count,byte_count,manifest_id,ticket:{payload,signature},expires_in:300};
}

export async function verifyExport(body, secret, actor) {
  const {payload,signature}=body.ticket || {};
  if(typeof payload!=='string' || payload.length>2000 || !/^[a-f0-9]{64}$/.test(signature || ''))throw new Error('Prepare the export before recording it.');
  const bytes=Uint8Array.from(signature.match(/../g),s=>parseInt(s,16));
  if(!await crypto.subtle.verify('HMAC',await key(secret),bytes,encoder.encode(payload)))throw new Error('Invalid export receipt.');
  const receipt=JSON.parse(payload);
  if(receipt.actor!==actor || receipt.term!==body.term_id || receipt.expires_at<Date.now())throw new Error('Export receipt expired or belongs to another session or term.');
  if(!Number.isSafeInteger(body.file_count) || !Number.isSafeInteger(body.byte_count) || body.file_count!==receipt.file_count || body.byte_count!==receipt.byte_count)throw new Error('Export file count or size does not match the manifest.');
  if(!Array.isArray(body.missing_files) || await digest(body.missing_files)!==receipt.missing_hash)throw new Error('Missing files do not match the manifest.');
  return receipt;
}
