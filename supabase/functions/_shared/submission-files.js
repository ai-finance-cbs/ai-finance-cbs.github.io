export const MAX_BYTES = 25 * 1024 * 1024;
export const TYPES = {
  pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip:'application/zip',
};
// Read the bounded ZIP directory, without extracting user-controlled paths or decompressing data.
function zipNames(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end = -1;
  for (let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) {
    if (view.getUint32(p,true)===0x06054b50 && p+22+view.getUint16(p+20,true)===bytes.length) { end=p; break; }
  }
  if (end<0 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0) return null;
  const count=view.getUint16(end+10,true), size=view.getUint32(end+12,true);
  let position=view.getUint32(end+16,true);
  if (position+size!==end || count>10000) return null;
  const names=[];
  for (let i=0;i<count;i++) {
    if (position+46>end || view.getUint32(position,true)!==0x02014b50) return null;
    const nameLength=view.getUint16(position+28,true), extra=view.getUint16(position+30,true), comment=view.getUint16(position+32,true);
    if (position+46+nameLength+extra+comment>end) return null;
    const local=view.getUint32(position+42,true);
    if (local+30>position || view.getUint32(local,true)!==0x04034b50) return null;
    names.push(new TextDecoder().decode(bytes.subarray(position+46,position+46+nameLength)));
    position+=46+nameLength+extra+comment;
  }
  return position===end ? names : null;
}
export function validSubmissionBytes(bytes, name, mime) {
  const ext=name.split('.').at(-1).toLowerCase();
  if (!bytes.length || bytes.length>MAX_BYTES || TYPES[ext]!==mime) return false;
  if (ext==='pdf') return new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-' &&
    new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-1024))).includes('%%EOF');
  if (bytes[0]!==0x50 || bytes[1]!==0x4b) return false;
  const names=zipNames(bytes);
  if (!names) return false;
  if (ext==='zip') return true;
  const main={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'}[ext];
  return names.includes('[Content_Types].xml') && names.includes(main);
}
