export const SUBMISSION_TYPES = {
  pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip:'application/zip',
};
// Fast feedback only. The file service repeats the check and validates Office ZIP directories.
export async function checkSubmissionFile(file) {
  const ext=file.name.split('.').at(-1).toLowerCase();
  if (!file.size || file.size>25*1024*1024 || SUBMISSION_TYPES[ext]!==file.type)
    throw new Error('Use PDF, DOCX, XLSX, PPTX, or ZIP up to 25 MB.');
  const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());
  if (ext==='pdf' ? new TextDecoder().decode(bytes)!=='%PDF-' : bytes[0]!==0x50 || bytes[1]!==0x4b)
    throw new Error('The file contents do not match its extension.');
}
export function defaultSubmissionItem(item) {
  const code=item.code;
  return {kind:code==='FP'?'link':['M1','M2','M3','M4','M5','O1','O2','O3'].includes(code)?'file':'none',
    mode:['M2','M3','M5','FP'].includes(code)?'group':'individual',group_set_id:null,due_at:null,...item};
}
export const safeSubmission = ({member_unis,submitted_by,data,on_time_data,...row}) => row;
