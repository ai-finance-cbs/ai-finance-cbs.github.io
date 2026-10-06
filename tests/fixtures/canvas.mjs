// Synthetic data only. No Canvas token, real student, or network request is used.
export function canvasFixture() {
  const enrollments=Array.from({length:6},(_,i)=>({user_id:i+1,course_section_id:10,enrollment_state:'active',user:{id:i+1,name:`Canvas student ${i+1}`,login_id:['aa1001','bb1002','cc1003','dd1004','ee1005','ff1006'][i],sis_user_id:`synthetic-${i+1}`}}));
  const assignments=Array.from({length:13},(_,i)=>({id:100+i,name:i===0?'Milestone #1':i===1?'Quiz Week 6':`Assignment ${i+1}`,published:true,due_at:'2027-03-01T14:00:00Z',points_possible:10,submission_types:['online_upload'],group_category_id:i===0?7:null,only_visible_to_overrides:false,overrides:[]}));
  const submissions=enrollments.flatMap(u=>assignments.map(a=>({user_id:u.user_id,assignment_id:a.id,workflow_state:'graded',late:false,missing:false,excused:false,late_policy_status:null,submitted_at:'2027-02-28T14:00:00Z',seconds_late:0,score:0,grade:'0',posted_at:'2027-03-02T14:00:00Z',assignment_visible:true})));
  return {enrollments,assignments,submissions,groups:[{id:80,category_id:7,category_name:'Project',name:'Group 1'}],group_members:[{id:1,group_id:80,name:'Canvas student 1'},{id:2,group_id:80,name:'Canvas student 2'}]};
}
