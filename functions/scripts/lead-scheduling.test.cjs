const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {chooseDuration, planTravel, findConflicts, HOME, eventTime, notifyConflicts, historyForLead} = require('../lib/leadAutomationScheduling');
const {CalendarApi} = require('../lib/leadAutomationGoogle');
const originalFetch = global.fetch;
afterEach(() => {global.fetch = originalFetch;});
const now=Date.parse('2099-07-01T00:00:00Z');
function event(id,start,end,location='123 Test St',managed=true){return {id,summary:id,location,start:{dateTime:`2099-07-10T${start}:00-07:00`},end:{dateTime:`2099-07-10T${end}:00-07:00`},extendedProperties:{private:managed?{thumbtackLeadId:id}:{}}};}
function assessment(minutes=null){return {appointment:{start:'2099-07-10T10:00:00-07:00',end:null},duration:{estimatedMinutes:minutes,rationale:'Lead and scope',recurring:false,recurringHistoryEventIds:[]}};}
const routeCalls=[];
const route=async(a,b)=>{routeCalls.push([a,b]);return {minutes:30,note:'Test route'};};
test('duration fallback, conservative rounding and unavailable rounding space',()=>{
 assert.equal(chooseDuration(assessment(),[],[]).minutes,120);
 assert.equal(chooseDuration(assessment(121),[],[]).minutes,180);
 const next=event('next','12:30','13:00');
 assert.equal(chooseDuration(assessment(121),[],[next]).minutes,121);
 // A conflict does not silently shrink the underlying work estimate.
 assert.equal(chooseDuration(assessment(180),[],[next]).minutes,180);
});
test('recurring duration uses the mean of verified prior visits, never fabricated IDs',()=>{
 const a=assessment(500);a.duration.recurring=true;a.duration.recurringHistoryEventIds=['first','second'];
 const history=[event('first','10:00','11:00'),event('second','10:00','13:00')];
 assert.equal(chooseDuration(a,history,[]).minutes,120);
 assert.match(chooseDuration(a,history,[]).basis,/Average of 2/);
 a.duration.recurringHistoryEventIds.push('invented');assert.throws(()=>chooseDuration(a,history,[]),/unsupported_recurring/);
});
test('history excludes other clients, travel and future events',()=>{
 const first=event('Brad Le — Cleaning','10:00','12:00');
 const other=event('Other','10:00','12:00','456 Somewhere');
 assert.equal(historyForLead([first,other],{name:'Brad Le',address:first.location},Date.parse('2099-07-11')).length,1);
 assert.equal(historyForLead([first],{name:'Brad Le'},now).length,0);
});
test('isolated job gets separate home-to-job and job-to-home bicycle trips',async()=>{
 routeCalls.length=0;const plans=await planTravel([event('job','10:00','12:00')],route,now);
 assert.equal(plans.length,2);assert.deepEqual(routeCalls,[[HOME,'123 Test St'],['123 Test St',HOME]]);
 assert.equal(eventTime(plans[0],'end'),eventTime(event('job','10:00','12:00'),'start'));
 assert.equal(findConflicts([...plans,event('job','10:00','12:00')],now).length,0);
});
test('jobs within one hour share a trip; boundary is inclusive and longer gaps use home',async()=>{
 const first=event('a','10:00','12:00','Address A');const second=event('b','13:00','15:00','Address B');
 routeCalls.length=0;let plans=await planTravel([first,second],route,now);
 assert.equal(plans.length,3);assert.ok(routeCalls.some(([a,b])=>a==='Address A'&&b==='Address B'));
 assert.equal(findConflicts([first,second,...plans],now).length,0);
 second.start.dateTime='2099-07-10T13:01:00-07:00';
 plans=await planTravel([first,second],route,now);assert.equal(plans.length,4);
});
test('manual adjacent appointment can supply the origin, missing addresses get 30 minutes',async()=>{
 const prior=event('Manual job','08:00','09:30','Address A',false);const job=event('b','10:00','12:00','');
 const plans=await planTravel([prior,job],async()=>{throw Error('must not route unknown address');},now);
 assert.equal(plans.length,2);assert.match(plans[0].location,/Address A/);
 for(const p of plans)assert.equal((eventTime(p,'end')-eventTime(p,'start'))/60000,30);
});
test('travel conflicts are detected when a connection cannot fit; touching boundaries are not conflicts',async()=>{
 const first=event('a','10:00','12:00');const second=event('b','12:10','14:00');
 const plans=await planTravel([first,second],route,now);const conflicts=findConflicts([first,second,...plans],now);
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].first.id,'a');
});
test('all-day blocks use Pacific midnight and respect DST transition dates',()=>{
 assert.equal(eventTime({start:{date:'2026-03-08'}},'start'),Date.parse('2026-03-08T08:00:00Z'));
 assert.equal(eventTime({start:{date:'2026-11-01'}},'start'),Date.parse('2026-11-01T07:00:00Z'));
 const job=event('job','10:00','12:00');const allDay={id:'busy',start:{date:'2099-07-10'},end:{date:'2099-07-11'}};
 assert.equal(findConflicts([job,allDay],now).length,1);
});
test('conflict alerts are sent once per event/time pair and marked unknown after ambiguous delivery',async()=>{
 const docs=new Map();const db={doc:path=>({path,update:async d=>docs.set(path,{...docs.get(path),...d})}),runTransaction:async fn=>fn({get:async r=>({exists:docs.has(r.path)}),create:(r,d)=>docs.set(r.path,d)})};
 let sends=0;global.fetch=async()=>{sends++;return Response.json({id:'sent'});};
 const events=[event('a','10:00','12:00'),event('b','11:00','13:00')];
 await notifyConflicts(db,'test',events,now);await notifyConflicts(db,'test',events,now);
 assert.equal(sends,1);assert.equal([...docs.values()][0].status,'sent');
 events[1].start.dateTime='2099-07-10T11:05:00-07:00';global.fetch=async()=>{sends++;throw Error('lost response');};
 await assert.rejects(notifyConflicts(db,'test',events,now),/delivery_unknown/);
 await notifyConflicts(db,'test',events,now);assert.equal(sends,2);
});
test('travel upserts survive retry, reschedule, cancellation and return without duplicates',async()=>{
 const events=new Map();let posts=0;
 global.fetch=async(url,init={})=>{
  const id=new URL(url).pathname.split('/').at(-1);
  if(init.method==='POST'){const body=JSON.parse(init.body);events.set(body.id,{...body,etag:'v1'});posts++;return Response.json(body);}
  if(!events.has(id))return new Response('',{status:404});
  if(init.method==='PATCH')events.set(id,{...events.get(id),...JSON.parse(init.body),etag:'v2'});
  return Response.json(events.get(id));
 };
 const api=new CalendarApi('test','owner');let [plan]=await planTravel([event('job','10:00','12:00')],route,now);
 await api.upsertTravel(plan.id,plan);await api.upsertTravel(plan.id,plan);assert.equal(posts,1);
 [plan]=await planTravel([event('job','11:00','13:00')],route,now);await api.upsertTravel(plan.id,plan);assert.equal(posts,1);
 await api.retireTravel(events.get(plan.id));assert.equal(events.get(plan.id).transparency,'transparent');
 await api.upsertTravel(plan.id,plan);assert.equal(events.get(plan.id).transparency,'opaque');assert.equal(posts,1);
 events.get(plan.id).summary='Edited manually';await assert.rejects(api.upsertTravel(plan.id,plan),/edited_manually/);
});
test('recorded recurring visits combine timer sessions and take precedence over calendar estimates',()=>{
 const {recordedVisits}=require('../lib/leadAutomationScheduling');
 const lead={jobId:'job1',name:'Client',jobTitle:'Weekly maintenance'};
 const start=Date.parse('2099-06-01T10:00:00-07:00');
 const history=recordedVisits([{startMs:start,endMs:start+60*60000},{startMs:start+90*60000,endMs:start+150*60000},{startMs:start+200*60000,endMs:null},{manual:true,startMs:start,endMs:start}],lead,now);
 assert.equal(history.length,1);assert.equal((eventTime(history[0],'end')-eventTime(history[0],'start'))/60000,120);
 const a=assessment(500);a.duration.recurring=true;a.duration.recurringHistoryEventIds=[history[0].id,'calendar'];
 assert.equal(chooseDuration(a,[...history,event('calendar','10:00','15:00')],[]).minutes,120);
});
test('missing address is allowed after duration is resolved',()=>{
 const {calendarBlockReason}=require('../lib/leadAutomationCore');
 assert.equal(calendarBlockReason({clientName:'Client',address:'',needsReview:[],appointment:{status:'confirmed',start:'2099-07-10T10:00:00-07:00',end:'2099-07-10T12:00:00-07:00'}},new Date(now)),null);
});
test('other reserved travel prevents rounding into busy time',()=>{
 const travel=event('travel','12:30','13:00');travel.extendedProperties.private={handyTravel:'v1',fromJob:'other'};
 assert.equal(chooseDuration(assessment(121),[],[travel],'own').minutes,121);
});
test('booking mode explicitly permits a conflict so the post-booking notifier can report it',async()=>{
 let inserted=false;
 global.fetch=async(url,init={})=>{
  if(init.method==='POST'){inserted=true;return Response.json(JSON.parse(init.body));}
  if(new URL(url).pathname.endsWith('/events'))throw Error('Pre-booking conflict blocking must be bypassed');
  return new Response('',{status:404});
 };
 const api=new CalendarApi('test','owner');const desired=event('new','10:00','12:00');
 await api.synchronize('lead',desired,null,'1','job',false,true);assert.equal(inserted,true);
});
test('an unrecorded successful job insert does not shorten its own rounded duration on retry',()=>{
 const orphan=event('created-before-response-lost','10:00','13:00');orphan.extendedProperties.private.thumbtackLeadId='lead';
 assert.equal(chooseDuration(assessment(121),[],[orphan],undefined,'lead').minutes,180);
});
test('a route lookup failure still alerts on existing travel conflicts',async()=>{
 const {reconcileTravel}=require('../lib/leadAutomationScheduling');
 const docs=new Map();const db={doc:path=>({path,get:async()=>{throw Error('route cache unavailable');},update:async d=>docs.set(path,{...docs.get(path),...d})}),runTransaction:async fn=>fn({get:async r=>({exists:docs.has(r.path)}),create:(r,d)=>docs.set(r.path,d)})};
 const job=event('job','10:00','12:00');const travel=event('travel','09:30','10:00');travel.extendedProperties.private={handyTravel:'v1'};
 const unrelated=event('other','09:45','10:00','Other address',false);const calendar={list:async()=>[job,travel,unrelated]};
 let sends=0;global.fetch=async()=>{sends++;return Response.json({id:'sent'});};
 await assert.rejects(reconcileTravel(db,calendar,'test','2099-07-11T00:00:00Z'),/route cache unavailable/);
 assert.equal(sends,1);
});
test('accepted arrival windows reserve enough time for the latest arrival plus the job',()=>{
 const a=assessment(120);a.appointment.arrivalWindowEnd='2099-07-10T10:30:00-07:00';
 const result=chooseDuration(a,[],[]);assert.equal(result.minutes,180);assert.match(result.basis,/30 minutes for the agreed arrival window/);
 const next=event('next','12:45','14:00');assert.equal(chooseDuration(a,[],[next]).minutes,150);
 a.appointment.arrivalWindowEnd='2099-07-10T09:30:00-07:00';assert.throws(()=>chooseDuration(a,[],[]),/invalid_arrival_window/);
});
