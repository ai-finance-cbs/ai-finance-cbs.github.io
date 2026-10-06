export function defaultSubmissionItem(item) {
  const code=item.code;
  return {kind:code==='FP'?'link':['M1','M2','M3','M4','M5','O1','O2','O3'].includes(code)?'file':'none',
    mode:['M2','M3','M5','FP'].includes(code)?'group':'individual',group_set_id:null,due_at:null,...item};
}
export const safeSubmission = ({member_unis,submitted_by,data,on_time_data,graded_at,...row}) => ({...row,locked:!!graded_at});
