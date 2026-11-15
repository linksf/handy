const {test}=require('node:test');
const assert=require('node:assert/strict');
const {persistPayment}=require('../lib/leadFinance');
function memoryDb(job) {
 const rows=new Map([['jobs/job',job]]);
 const snapshot=path=>({exists:rows.has(path),get:key=>rows.get(path)?.[key],data:()=>rows.get(path)});
 const db={rows,doc:path=>({path}),collection:()=>({where:()=>({query:true})}),runTransaction:async fn=>{
  const writes=[];
  const result=await fn({get:async ref=>ref.query?{docs:[...rows.keys()].filter(k=>k.startsWith('payments/')).map(snapshot)}:snapshot(ref.path),
   create:(ref,data)=>writes.push(()=>rows.set(ref.path,data)),update:(ref,data)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...data}))});
  writes.forEach(w=>w());return result;
 }};return db;
}
const input=(sourceId,invoiceId,amountCents,extra={})=>({jobId:'job',source:'manual',sourceId,invoiceId,amountCents,date:'2026-11-02',...extra});
const job=()=>({amountPaid:100,price:500,invoices:[{id:'primary',name:'First'},{id:'second',name:'Second'}]});
test('payments are scoped, aggregate once, deduplicate and refund only their own invoice',async()=>{
 const db=memoryDb(job());
 await persistPayment(db,input('a','second',20000));
 assert.equal(db.rows.get('jobs/job').amountPaid,300);
 assert.equal(db.rows.get('jobs/job').invoicePaid.second,200);
 await persistPayment(db,input('a','second',20000));
 assert.equal(db.rows.get('jobs/job').amountPaid,300);
 await assert.rejects(()=>persistPayment(db,input('b','second',-25000)),/this invoice/);
 await persistPayment(db,input('c','second',-5000));
 assert.equal(db.rows.get('jobs/job').amountPaid,250);
 assert.equal(db.rows.get('jobs/job').invoicePaid.second,150);
 await assert.rejects(()=>persistPayment(db,input('a','primary',20000)),/another invoice/);
});
test('historical dates preserve paid totals and cannot exceed undated payments on selected invoice',async()=>{
 const db=memoryDb(job());
 await persistPayment(db,input('dated','primary',10000,{historical:true}));
 assert.equal(db.rows.get('jobs/job').amountPaid,100);
 await assert.rejects(()=>persistPayment(db,input('dated-too-much','primary',100,{historical:true})),/undated/);
 await assert.rejects(()=>persistPayment(db,input('wrong-invoice','second',100,{historical:true})),/undated/);
 await assert.rejects(()=>persistPayment(db,input('missing','missing',100)),/Invoice not found/);
});
