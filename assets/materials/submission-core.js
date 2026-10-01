export const SUBMISSION_TYPES = {
  pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip:'application/zip',
};
// Operating systems disagree about MIME labels. Extensions determine our canonical type.
export function submissionContentType(file) {
  const type=SUBMISSION_TYPES[file.name.split('.').at(-1).toLowerCase()];
  if (!type) throw new Error('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
  return type;
}
// Fast feedback only. The file service repeats the check and validates Office ZIP directories.
export async function checkSubmissionFile(file) {
  const ext=file.name.split('.').at(-1).toLowerCase();
  submissionContentType(file);
  if (!file.size || file.size>25*1024*1024)
    throw new Error('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
  const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
  if (ext==='pdf' ? new TextDecoder().decode(bytes)!=='%PDF-' : bytes[0]!==0x50 || bytes[1]!==0x4b)
    throw new Error('The file contents do not match its extension.');
  if (ext==='pdf' && !(await file.slice(Math.max(0,file.size-1024)).text()).includes('%%EOF'))
    throw new Error('The PDF is incomplete: its end marker is missing.');
}
export function defaultSubmissionItem(item) {
  const code=item.code;
  return {kind:code==='FP'?'link':['M1','M2','M3','M4','M5','O1','O2','O3'].includes(code)?'file':'none',
    mode:['M2','M3','M5','FP'].includes(code)?'group':'individual',group_set_id:null,due_at:null,...item};
}
export const safeSubmission = ({member_unis,submitted_by,data,on_time_data,graded_at,...row}) => ({...row,locked:!!graded_at});
