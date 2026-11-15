const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generateKeyPairSync, sign} = require('node:crypto');
const {verifyTelnyx, parseSmsEvent} = require('../lib/telnyxCore');
const {processSmsEvent, telnyxWebhook, telnyxWebhookFallback} = require('../lib/telnyxWebhook');
const pair = generateKeyPairSync('ed25519');
const key = pair.publicKey.export({format:'der', type:'spki'}).subarray(-32).toString('base64');
const raw = Buffer.from(JSON.stringify({data:{id:'evt-test',event_type:'message.received',occurred_at:new Date().toISOString(),payload:{id:'msg-test',text:'Test',from:{phone_number:'+12025550123'},to:[{phone_number:'+12025550124'}]}}}));
const timestamp = String(Math.floor(Date.now()/1000));
const signature = sign(null, Buffer.concat([Buffer.from(`${timestamp}|`),raw]),pair.privateKey).toString('base64');
test('accepts valid raw Ed25519 signature in base64 and PEM formats',()=>{
  assert.equal(verifyTelnyx(raw,timestamp,signature,key),true);
  assert.equal(verifyTelnyx(raw,timestamp,signature,pair.publicKey.export({format:'pem',type:'spki'})),true);
});
test('rejects altered bodies, wrong keys, missing headers, and stale or future timestamps',()=>{
  assert.equal(verifyTelnyx(Buffer.concat([raw,Buffer.from(' ')]),timestamp,signature,key),false);
  for(const t of ['', 'garbage', String(Number(timestamp)-301),String(Number(timestamp)+301)]) assert.equal(verifyTelnyx(raw,t,signature,key),false);
  assert.equal(verifyTelnyx(raw,timestamp,signature,''),false);
  assert.equal(verifyTelnyx(raw,timestamp,'',key),false);
});
test('validates event structure and incoming phone identity',()=>{
  assert.equal(parseSmsEvent(raw).id,'evt-test');
  const bad = JSON.parse(raw); bad.data.payload.from.phone_number='unknown';
  assert.throws(()=>parseSmsEvent(Buffer.from(JSON.stringify(bad))));
  bad.data.id='../bad'; assert.throws(()=>parseSmsEvent(Buffer.from(JSON.stringify(bad))));
});
test('delivery updates are stored separately to preserve out of order events',async()=>{
  const writes=[]; const statuses=[];
  const store={doc:path=>({collection:()=>({doc:id=>({set:async data=>writes.push({path,id,data})})})})};
  const base=parseSmsEvent(raw);
  for(const type of ['message.finalized','message.sent']) await processSmsEvent(store,{update:async d=>statuses.push(d)}, {...base,id:type,event_type:type});
  assert.equal(writes.length,2); assert.notEqual(writes[0].id,writes[1].id);
  assert.deepEqual(statuses,[{status:'processed'},{status:'processed'}]);
});
test('unmatched incoming messages remain captured for review',async()=>{
  const statuses=[];
  const store={doc:path=>({get:async()=>({get:()=>null}),collection:()=>({doc:()=>({set:async()=>{}})})}),collection:()=>({where:()=>({limit:()=>({get:async()=>({docs:[],size:0})})})})};
  await processSmsEvent(store,{update:async d=>statuses.push(d)},parseSmsEvent(raw));
  assert.deepEqual(statuses,[{status:'needs_review',reason:'lead_link_required'}]);
});
test('both HTTP handlers reject methods, missing configuration and forged signatures',async()=>{
  const previous=process.env.TELNYX_PUBLIC_KEY;
  try {
    for (const endpoint of [telnyxWebhook,telnyxWebhookFallback]) {
      const request=async(method,headers={},body=raw)=>{
        const result={headers:{}};
        const response={set:(k,v)=>{result.headers[k]=v;return response;},status:n=>{result.status=n;return response;},json:b=>{result.body=b;return response;}};
        await endpoint({method,rawBody:body,get:k=>headers[k]},response);
        return result;
      };
      process.env.TELNYX_PUBLIC_KEY='UNCONFIGURED';
      assert.equal((await request('POST')).status,503);
      const get=await request('GET'); assert.equal(get.status,405); assert.equal(get.headers.Allow,'POST');
      process.env.TELNYX_PUBLIC_KEY=key;
      assert.equal((await request('POST')).status,401);
      assert.equal((await request('POST',{'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature},Buffer.concat([raw,Buffer.from(' ')]))).status,401);
      const invalid=Buffer.from('{}');
      const sig=sign(null,Buffer.concat([Buffer.from(`${timestamp}|`),invalid]),pair.privateKey).toString('base64');
      assert.equal((await request('POST',{'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':sig},invalid)).status,400);
    }
  } finally { if(previous===undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY=previous; }
});
test('signed HTTP delivery commits once across primary and fallback; storage failure returns 503',async()=>{
  const fs=require('node:fs'), vm=require('node:vm'), {createRequire}=require('node:module');
  const filename=require.resolve('../lib/telnyxWebhook');
  const localRequire=createRequire(filename), realAdmin=require('firebase-admin');
  const documents=new Map(); let failing=false;
  const store={doc:path=>({path}),runTransaction:async fn=>{
    if(failing) throw Error('offline');
    return fn({get:async ref=>({exists:documents.has(ref.path)}),create:(ref,data)=>documents.set(ref.path,data)});
  }};
  const firestore=()=>store; firestore.FieldValue=realAdmin.firestore.FieldValue;
  const fakeAdmin={apps:[{}],firestore};
  const mod={exports:{}};
  vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename,'utf8')}\n})`,{filename})(
    name=>name==='firebase-admin'?fakeAdmin:name==='firebase-functions/logger'?{error:()=>{}}:localRequire(name),mod,mod.exports,filename,require('node:path').dirname(filename));
  const previous=process.env.TELNYX_PUBLIC_KEY; process.env.TELNYX_PUBLIC_KEY=key;
  try {
    async function send(endpoint){
      const result={}; const response={set:()=>response,status:n=>{result.status=n;return response;},json:b=>{result.body=b;return response;}};
      await endpoint({method:'POST',rawBody:raw,get:k=>({'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature}[k])},response);
      return result;
    }
    const primary=await send(mod.exports.telnyxWebhook), fallback=await send(mod.exports.telnyxWebhookFallback);
    assert.equal(primary.status,200); assert.equal(primary.body.duplicate,false);
    assert.equal(fallback.status,200); assert.equal(fallback.body.duplicate,true);
    assert.equal(documents.size,1); assert.equal([...documents.values()][0].status,'pending');
    failing=true; assert.equal((await send(mod.exports.telnyxWebhook)).status,503);
  } finally {if(previous===undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY=previous;}
});
