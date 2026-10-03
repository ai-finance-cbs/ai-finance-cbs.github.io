import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {readFileSync} from 'node:fs';
import {calendarFeed} from '../supabase/functions/calendar/ical.js';
import {createHandler} from '../supabase/functions/calendar/handler.js';
import {WEEK_TITLES} from '../assets/materials/core.js';
const data={term_id:'spring-2027',sessions:Array.from({length:6},(_,i)=>({week:i+1,starts_at:`2027-02-0${i+1}T14:00:00Z`,ends_at:`2027-02-0${i+1}T17:00:00Z`})),items:[{id:2,code:'M2',title:'Public milestone',due_at:'2027-03-15T13:00:00Z'}]};
function parse(feed){const c=new ICAL.Component(ICAL.parse(feed));const zone=c.getFirstSubcomponent('vtimezone');ICAL.TimezoneService.register(new ICAL.Timezone(zone));return {c,events:c.getAllSubcomponents('vevent').map(e=>new ICAL.Event(e))};}
test('calendar parses independently with six classes, correct titles, timezone, deadline duration and alarm',()=>{
  const feed=calendarFeed(data,{location:'Room 101, CBS; Manhattan'}),{c,events}=parse(feed);
  assert.equal(c.name,'vcalendar');assert.equal(c.getFirstPropertyValue('version'),'2.0');assert.equal(events.length,7);
  events.slice(0,6).forEach((e,i)=>{assert.equal(e.summary,`B8403 Week ${i+1}: ${WEEK_TITLES[i]}`);assert.equal(e.location,'Room 101, CBS; Manhattan');assert.equal(e.startDate.hour,9);assert.equal(e.endDate.hour,12);assert.equal(e.startDate.zone.tzid,'America/New_York');assert.equal(e.startDate.toJSDate().toISOString(),new Date(data.sessions[i].starts_at).toISOString());});
  const due=events.at(-1);assert.equal(due.summary,'Due: M2 · Public milestone');assert.equal(due.duration.toSeconds(),900);
  assert.equal(due.startDate.toJSDate().toISOString(),'2027-03-15T13:00:00.000Z');
  assert.equal(due.component.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toSeconds(),-86400);
});
test('DST boundaries preserve New York wall times; date edits preserve UIDs and change event times',()=>{
  for(const [start,finish] of [['2027-03-13T14:00:00Z','2027-03-13T17:00:00Z'],['2027-03-15T13:00:00Z','2027-03-15T16:00:00Z'],['2027-11-06T13:00:00Z','2027-11-06T16:00:00Z'],['2027-11-08T14:00:00Z','2027-11-08T17:00:00Z']]) {
    const {events}=parse(calendarFeed({...data,sessions:[{week:1,starts_at:start,ends_at:finish}]}));
    assert.equal(events[0].startDate.hour,9);assert.equal(events[0].startDate.toJSDate().toISOString(),new Date(start).toISOString());
    assert.equal(events[0].uid,parse(calendarFeed(data)).events[0].uid);
  }
  const old=parse(calendarFeed(data)).events.at(-1),next=parse(calendarFeed({...data,items:[{...data.items[0],due_at:'2027-03-16T13:00:00Z'}]})).events.at(-1);
  assert.equal(old.uid,next.uid);assert.notEqual(old.startDate.toString(),next.startDate.toString());
});
test('Unicode line folding and escaped text cannot inject events or leak extra fields',()=>{
  const title='한글'.repeat(80)+',;\\\nBEGIN:VEVENT',feed=calendarFeed({...data,roster:['PRIVATE'],instructions:'SECRET',items:[{...data.items[0],title,description:'PRIVATE'}]});
  assert.ok(feed.split('\r\n').every(line=>Buffer.byteLength(line)<=75));assert.doesNotMatch(feed,/PRIVATE|SECRET/);
  const {events}=parse(feed);assert.equal(events.length,7);assert.equal(events.at(-1).summary,`Due: M2 · ${title}`);
});
test('public handler uses only the service projection, ignores term/auth input, caches GET and HEAD, and masks errors',async()=>{
  const calls=[];const run=createHandler((...args)=>{calls.push(args);return {rpc:async(...args)=>{calls.push(args);return {data};}};},name=>({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',CALENDAR_LOCATION:'Room 1'})[name]);
  const response=await run(new Request('https://example.test/calendar?term=archived',{headers:{Authorization:'Bearer forged'}}));
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/calendar/);assert.match(response.headers.get('cache-control'),/max-age=300/);
  assert.equal(parse(await response.text()).events.length,7);assert.deepEqual(calls[1],['calendar_data']);assert.equal(calls[0][1],'synthetic');assert.doesNotMatch(JSON.stringify(calls),/archived|forged/);
  assert.equal(await (await run(new Request('https://example.test/calendar',{method:'HEAD'}))).text(),'');
  const before=calls.length;assert.equal((await run(new Request('https://example.test/calendar',{method:'POST'}))).status,405);assert.equal(calls.length,before);
  const fail=createHandler(()=>({rpc:async()=>({error:new Error('SECRET')})}),()=> 'synthetic');const failed=await fail(new Request('https://example.test'));assert.equal(failed.status,503);assert.equal(await failed.text(),'Calendar unavailable.');
  assert.match(readFileSync('supabase/config.toml','utf8'),/\[functions.calendar\]\s*verify_jwt = false/);
});
