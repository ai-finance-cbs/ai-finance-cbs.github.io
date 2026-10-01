// ZIP work stays in the browser. The function only authorizes files and checks completion counts.
const ZIP_MODULE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js';
async function downloadArchive(blob, filename) {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),300000);
}
export async function exportTermArchive(term, request, {
  loadZip=()=>import(ZIP_MODULE), fetchFile=fetch, saveArchive=downloadArchive, progress=()=>{},
}={}) {
  const {Zip,ZipPassThrough,strToU8}=await loadZip();
  let manifest=await request({action:'export',term_id:term}), refreshes=0;
  const downloaded=new Map();
  for(let index=0;index<manifest.files.length;) {
    const file=manifest.files[index], cached=downloaded.get(file.name);
    if(cached?.size===file.size && cached.path===file.path){index++;continue;}
    progress(`Downloading ${index+1} of ${manifest.files.length} files…`);
    const response=await fetchFile(file.url,{cache:'no-store',credentials:'omit'});
    if(!response.ok) {
      // Renew expired URLs and let the server identify any objects removed since preparation.
      if([400,401,403,404].includes(response.status) && refreshes++<3) {
        manifest=await request({action:'export',term_id:term});index=0;continue;
      }
      throw new Error('A file could not be downloaded. Export was not recorded. Retry.');
    }
    const blob=await response.blob();
    if(blob.size!==file.size)throw new Error('Downloaded file size does not match the manifest. Export was not recorded.');
    downloaded.set(file.name,{blob,path:file.path,size:file.size});index++;
  }
  progress('Writing ZIP…');
  const parts=[];let zipError, finished=false;
  const zip=new Zip((error,chunk,final)=>{if(error)zipError=error;else parts.push(new Blob([chunk]));if(final)finished=true;});
  const add=(name,bytes)=>{const entry=new ZipPassThrough(name);zip.add(entry);entry.push(bytes,true);if(zipError)throw zipError;};
  add('grades.csv',strToU8(manifest.csv));
  // Signed URLs and the completion ticket never enter the saved metadata.
  add('manifest.json',strToU8(JSON.stringify(manifest.metadata,null,2)));
  let file_count=0,byte_count=0;
  for(const file of manifest.files) {
    const saved=downloaded.get(file.name);
    add(file.name,new Uint8Array(await saved.blob.arrayBuffer()));
    file_count++;byte_count+=saved.blob.size;downloaded.delete(file.name);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  zip.end();if(zipError)throw zipError;if(!finished)throw new Error('ZIP did not finish. Export was not recorded.');
  await saveArchive(new Blob(parts,{type:'application/zip'}),`${term}.zip`);
  // Never record after a failed download, ZIP write, or save callback.
  await request({action:'record',term_id:term,ticket:manifest.ticket,file_count,byte_count,missing_files:manifest.metadata.missing_files});
  return {file_count,byte_count,missing_files:manifest.metadata.missing_files};
}
