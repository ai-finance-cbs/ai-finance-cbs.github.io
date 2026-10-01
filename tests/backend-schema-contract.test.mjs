import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createBackend} from '../assets/materials/supabase.js';
import {phaseDatabase,TERM,people} from './helpers/phase-a.mjs';
let h,backend,who='teacher';
const mutations=[];
const ident=value=>{assert.match(value,/^[a-z_]+$/i);return '"'+value+'"';};
// Exercise the adapter's actual requests against PostgreSQL grants and RLS, with no network.
function query(table) {
  let verb='select',values={},fields='*',returning=false,one=false,upsert=false;
  const filters=[],orders=[];
  const q={
    select(f='*'){fields=f;if(verb!=='select')returning=true;return this;},
    insert(v){verb='insert';values=v;mutations.push({table,verb,values});return this;},
    upsert(v){this.insert(v);upsert=true;return this;},
    update(v){verb='update';values=v;mutations.push({table,verb,values});return this;},
    delete(){verb='delete';return this;},
    eq(k,v){filters.push([k,v]);return this;},
    order(k,options={}){orders.push(`${ident(k)} ${options.ascending===false?'desc':'asc'}`);return this;},
    single(){one=true;return this;},
    then(resolve,reject){return execute().then(resolve,reject);},
  };
  async function execute() {
    const params=[],bind=v=>{params.push(typeof v==='object' && v!==null?JSON.stringify(v):v);return '$'+params.length;};
    const columns=fields==='*'?'*':fields.split(',').map(ident).join(',');
    let sql;
    if(verb==='select')sql=`select ${columns} from ${ident(table)}`;
    else if(verb==='delete')sql=`delete from ${ident(table)}`;
    else if(verb==='update')sql=`update ${ident(table)} set ${Object.entries(values).map(([k,v])=>`${ident(k)}=${bind(v)}`).join(',')}`;
    else {
      sql=`insert into ${ident(table)}(${Object.keys(values).map(ident).join(',')}) values(${Object.values(values).map(bind).join(',')})`;
      if(upsert)sql+=' on conflict(email) do update set role=excluded.role';
    }
    if(filters.length)sql+=' where '+filters.map(([k,v])=>`${ident(k)}=${bind(v)}`).join(' and ');
    if(verb==='select' && orders.length)sql+=' order by '+orders.join(',');
    if(returning)sql+=' returning '+columns;
    try {const rows=await h.rows(sql,params);return {data:one?rows[0]:rows};}catch(error){return {error};}
  }
  return q;
}
before(async()=>{
  h=await phaseDatabase();await h.as('owner');
  await h.rows("insert into assignments(term_id,id,title,due,points,description,deliverable,grading,auditor_visible) values($1,1,'Demo','Week 1',10,'Synthetic','Demo','Demo',false)",[TERM]);
  const client={from:query,rpc:async(name,args={})=>{
    const params=Object.values(args).map(v=>typeof v==='object' && v!==null?JSON.stringify(v):v);
    try {return {data:(await h.rows(`select public.${ident(name)}(${Object.keys(args).map((k,i)=>`${ident(k)}=>$${i+1}`).join(',')}) value`,params))[0].value};}catch(error){return {error};}
  },auth:{getSession:async()=>({data:{session:{}}}),getUser:async()=>({data:{user:{email:people[who],email_confirmed_at:'yes',app_metadata:{provider:'google'}}}})},
  storage: { from: bucket => ({ upload: async path => {
    try { await h.rows('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path]); return {}; }
    catch(error) { return {error}; }
  } }) } };

  globalThis.window={supabase:{createClient:()=>client}};backend=await createBackend({url:'local',key:'synthetic'});
  await h.as('teacher');await backend.getAccess();
});
after(async()=>h?.db.close());
test('review 12: legacy assignment and announcement edits use permitted columns and the current term key',async()=>{
  const row=(await backend.assignments())[0];await backend.saveAssignment({...row,title:'Edited',created_at:'ignored',unexpected:'ignored'});
  assert.equal((await backend.assignments())[0].title,'Edited');
  assert.deepEqual(Object.keys(mutations.at(-1).values).sort(),['title','due','points','description','deliverable','grading','auditor_visible'].sort());
  const item=await backend.saveAnnouncement({title:'Demo announcement',body:'Synthetic',created_at:'ignored'});
  await backend.saveAnnouncement({...item,title:'Edited announcement',body:'Changed',term_id:'forged'});
  assert.equal((await backend.announcements())[0].title,'Edited announcement');await backend.deleteAnnouncement(item.id);
  assert.deepEqual(await backend.announcements(),[]);
});
test('review 12: legacy file upload, visibility and release work under narrow column grants',async()=>{
  await backend.uploadFile(new File(['%PDF-1.7\n%%EOF'],'notes.pdf',{type:'application/pdf'}),{week:0,title:'Prelude',category:'in_class',auditor_visible:true,id:'ignored',term_id:'forged',created_at:'ignored'});
  const file=(await backend.files())[0];assert.equal(file.term_id,TERM);assert.equal(file.week,0);assert.equal(file.category,'in_class');
  assert.deepEqual(Object.keys(mutations.at(-1).values).sort(),['week','title','category','auditor_visible','storage_path'].sort());
  await backend.setFileVisibility(file.id,false);await backend.setFileRelease(file.id,false,'2099-01-01');
  const changed=(await backend.files())[0];assert.equal(changed.auditor_visible,false);assert.equal(changed.released,false);
});
test('review 12: existing staff tools use the new RPC signatures and term-scoped tables',async()=>{
  await backend.replaceRoster([{uni:'aa1001',name:'Alice'},{uni:'bb1002',name:'Bob'}]);assert.equal((await backend.adminData()).roster.length,2);
  await backend.saveAllowlist({email:'extra@columbia.edu',role:'auditor'});await backend.removeAllowlist('extra@columbia.edu');
  await backend.linkStudent('alias@gsb.columbia.edu','aa1001');assert.ok((await backend.studentAccounts()).some(r=>r.uni==='aa1001'));await backend.linkStudent('alias@gsb.columbia.edu',null);
  assert.ok(Array.isArray(await backend.testAccounts()));assert.equal((await backend.terms())[0].id,TERM);
  await backend.setSessionDate(1,'2027-03-01');await backend.setSessionTimes(1,'2027-03-01T14:00Z','2027-03-01T17:00Z');assert.equal(new Date((await backend.sessions())[0].date).toISOString().slice(0,10),'2027-03-01');
  await backend.saveAttendance(1,[{uni:'aa1001',status:'present'}]);await backend.saveGrades([{uni:'aa1001',item_id:1,score:8,comment:'Comment'}]);await backend.releaseItem(1,true);
  await backend.createSet({title:'Adapter group',count:2,max_size:4,deadline:null});let d=await backend.classData();const set=d.sets[0],group=d.groups[0];
  await backend.updateSet(set.id,true,null);await backend.chooseGroup(set.id,group.id,'aa1001');
  await backend.configureItem(2,{kind:'file',mode:'group',group_set_id:set.id,due_at:null});
  await backend.setPreview('aa1001');assert.equal((await backend.classData()).grades[0].comment,'Comment');assert.equal((await backend.files()).length,0);
  await backend.saveAssignment({id:1,title:'Forbidden'}).catch(error=>assert.equal(error.code,'42501'));
  await backend.setPreview('bb1002');assert.equal((await backend.classData()).grades.length,0);await backend.setPreview(null);
  assert.equal((await backend.assignments())[0].title,'Edited');
  who='a';await h.as('a');await backend.getAccess();assert.equal((await backend.classData()).grades[0].comment,'Comment');
  await assert.rejects(backend.saveGrades([{uni:'aa1001',item_id:1,score:9}]),/Grading/);
});
