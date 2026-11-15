const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {renderBriefHtml}=require('../lib/dailyBriefEmail');
const {sendBrief}=require('../lib/leadAutomationGoogle');
const original=global.fetch;afterEach(()=>{global.fetch=original;});
const now=new Date('2026-10-26T17:00:00Z');
const thread=(id,name)=>({leadId:id,version:1,assessedVersion:1,assessment:{clientName:name,jobSummary:'Repair gate',stage:'scheduled',appointment:{status:'confirmed'},needsReview:['Confirm access'],followUp:{owner:'business',reason:'Send estimate',dueAt:null}}});
test('groups visits and followups by lead, escapes content and excludes cancelled events',()=>{
 const html=renderBriefHtml(now,[{summary:'Gate visit',start:{dateTime:'2026-10-27T17:00:00Z'},extendedProperties:{private:{thumbtackLeadId:'a'}},description:'First note\n<script>unsafe</script>',htmlLink:'javascript:alert(1)'},{summary:'Hidden',status:'cancelled'}],[thread('a','Alex <script>'),thread('b','Alex <script>')],[]);
 assert.equal((html.match(/<h2[^>]*>Alex &lt;script&gt;<\/h2>/g)||[]).length,2);
 assert.match(html,/Upcoming visits/);assert.match(html,/Your follow-up/);assert.match(html,/<li[^>]*>First note/);assert.match(html,/&lt;script&gt;unsafe/);assert.doesNotMatch(html,/javascript:|<script>|Hidden/);
});
test('stale assessments cannot recommend outdated actions',()=>{
 const t=thread('a','Alex');t.dirty=true;
 const html=renderBriefHtml(now,[],[t],['Calendar could not be read.']);
 assert.match(html,/waiting to be processed/);assert.doesNotMatch(html,/Send estimate|Confirm access|Repair gate|No upcoming appointments/);
});
test('HTML email retains exact plain fallback, owner and stable message id',async()=>{
 let raw;global.fetch=async(url,init)=>{raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();return Response.json({id:'accepted'});};
 assert.equal(await sendBrief('test','Test','Plain ü','2026-10-26','<p>HTML ü</p>'),'accepted');
 assert.match(raw,/To: shane@omnificology.com/);assert.match(raw,/Message-ID: <handy-brief-2026-10-26@omnificology.com>/);assert.match(raw,/multipart\/alternative/);
 const parts=[...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)(?=\r\n--)/g)].map(m=>Buffer.from(m[1].replace(/\r\n/g,''),'base64').toString());
 assert.deepEqual(parts,['Plain ü','<p>HTML ü</p>']);
 await sendBrief('test','Test','Plain only','other');assert.doesNotMatch(raw,/multipart/);assert.match(raw,/text\/plain/);
});
