import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from '../assets/materials/demo.js';
const TERM='spring-2027',KEY='b8403-demo-state-v3';let b;
const change=fn=>{const d=JSON.parse(sessionStorage.getItem(KEY));fn(d);sessionStorage.setItem(KEY,JSON.stringify(d));};
const member=uni=>sessionStorage.setItem('b8403-demo-user-v1',JSON.stringify({email:`${uni}@columbia.edu`,uni}));
beforeEach(async()=>{
  const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.window={location:new URL('http://127.0.0.1:4189/materials/')};b=createDemo();await b.pickRole('instructor');await b.syncCanvas(TERM);
  change(d=>{const v=d.canvas[TERM];v.submissions.forEach(s=>s.cached_due_at=new Date(Date.now()+86400000).toISOString());
    v.groups.push({id:'11',category_id:'1',category_name:'Prototype',name:'Other group'});v.group_members.push({group_id:'11',user_id:'3',name:'Third Student'});});await b.pickRole('student');
});
test('demo members share and replace the group row, while other groups stay private',async()=>{
  const first=await b.saveGroupLink(TERM,'M3','https://team.github.io');member('cd5678');assert.deepEqual((await b.myGroupLink(TERM,'M3')).submission,first);
  const second=await b.saveGroupLink(TERM,'M3','https://custom.test');assert.equal(second.submitted_by_name,'Second Student');member('ab1234');assert.deepEqual((await b.myGroupLink(TERM,'M3')).submission,second);
  member('ef9012');assert.equal((await b.myGroupLink(TERM,'M3')).submission,null);await b.pickRole('grader');const rows=(await b.groupLinkClass(TERM,'M3')).groups;assert.equal(rows.length,2);assert.equal(rows[1].submission,null);
});
for(const role of ['student','instructor','grader','auditor','unlisted'])test(`demo ${role}: group-link RPC boundaries`,async()=>{
  await b.pickRole(role);if(role==='student'){await b.myGroupLink(TERM,'M3');await b.saveGroupLink(TERM,'M3','https://a.test');}else{await assert.rejects(b.myGroupLink(TERM,'M3'));await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'));}
  if(['instructor','grader'].includes(role))await b.groupLinkClass(TERM,'M3');else await assert.rejects(b.groupLinkClass(TERM,'M3'));
});
test('no group, missing category, missing mapping, and group changes use Canvas only',async()=>{
  await b.saveGroupLink(TERM,'M3','https://first.test');change(d=>d.canvas[TERM].group_members.find(m=>m.user_id==='1').group_id='11');assert.equal((await b.myGroupLink(TERM,'M3')).submission,null);
  member('cd5678');assert.equal((await b.myGroupLink(TERM,'M3')).submission.link,'https://first.test');
  change(d=>d.canvas[TERM].group_members=[]);assert.equal((await b.myGroupLink(TERM,'M3')).group,null);await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/Join your group/);
  change(d=>{const c=d.canvas[TERM],m=c.mappings.find(m=>m.site_key==='M3');c.assignments.find(a=>a.id===m.canvas_assignment_id).group_category_id=null;});assert.equal((await b.myGroupLink(TERM,'M3')).setup,false);await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/not set up/);
  change(d=>d.canvas[TERM].mappings=[]);assert.equal((await b.myGroupLink(TERM,'M3')).setup,false);
});
test('preview, archives, unavailable syncs, invalid links, and effective deadlines reject saves',async()=>{
  await assert.rejects(b.saveGroupLink(TERM,'M3','http://a.test'));
  await assert.rejects(b.myGroupLink(TERM,'FP'));await b.saveGroupLink(TERM,'M3','https://a.test');
  await b.pickRole('instructor');await b.setPreview('ab1234');assert.equal((await b.myGroupLink(TERM,'M3')).read_only,true);await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/read-only/);await assert.rejects(b.groupLinkClass(TERM,'M3'));await b.setPreview(null);await b.pickRole('student');
  change(d=>d.canvas[TERM].submissions.forEach(s=>s.cached_due_at=null));assert.equal((await b.myGroupLink(TERM,'M3')).closed,true);await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/deadline/);
  change(d=>d.canvas[TERM].submissions.forEach(s=>s.cached_due_at='2000-01-01'));await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/closed/);
  change(d=>d.canvas[TERM].runs.forEach(r=>r.status='failed'));await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/unavailable/);
  await b.pickRole('instructor');await b.openTerm('Spring 2028');await b.pickRole('student');assert.equal((await b.myGroupLink(TERM,'M3')).read_only,true);await assert.rejects(b.saveGroupLink(TERM,'M3','https://a.test'),/read-only/);await assert.rejects(b.myGroupLink('spring-2028','M3'));
});
