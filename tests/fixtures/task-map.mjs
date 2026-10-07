import {emptyTaskMap, TASK_LABELS} from '../../assets/materials/task-map-core.js';
export function taskMapFixture() {
  const value = emptyTaskMap();
  value.job = {firm_type:'Bank',role:'Summer analyst',duration:'Ten weeks'};
  value.tasks = Array.from({length:8},(_,i)=>({name:`Task ${i+1}`,description:`Concrete action ${i+1}`,label:TASK_LABELS[i%4]}));
  value.look_ahead = {name:'Check AI output',description:'Review supporting evidence',label:'Own',reasoning:'A person remains responsible for each decision.'};
  value.ai_use = 'Used AI to check the task labels.';
  return value;
}
