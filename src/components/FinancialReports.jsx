import {useEffect,useState} from 'react';
import {httpsCallable} from 'firebase/functions';
import {functions} from '../firebase';
import Card from './ui/Card';
const dollars=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((n||0)/100);
export default function FinancialReports({ctx} = {}){
 const [kind,setKind]=useState('week');const [date,setDate]=useState(new Date().toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'}));const [report,setReport]=useState(null);const [error,setError]=useState('');
 useEffect(()=>{let active=true;setReport(null);setError('');httpsCallable(functions,'getFinancialReport')({kind,date}).then(r=>{if(active)setReport(r.data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[kind,date]);
 return <div><h2>Financial reports</h2><p>Money collected minus recorded expenses and lead fees. Dates are Pacific.</p><label>Period <select value={kind} onChange={e=>setKind(e.target.value)}><option value="week">Week (Monday–Sunday)</option><option value="month">Month</option></select></label> <label>Containing date <input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}{!report&&!error&&<p>Loading report…</p>}{report&&<><p>{report.start} to {report.end} (end date excluded)</p>{(report.undatedPaymentsCents||report.undatedExpensesCents||report.undatedLeadFeesCents||report.unknownLeadFeeCount)>0&&<p role="note">Historical data is incomplete: period totals exclude undated and unknown amounts listed below.</p>}<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>{[['Collected','collectedCents'],['Expenses','expenseCents'],['Lead fees, net','leadFeesCents'],['Converted lead fees','convertedFeesCents'],['Unconverted lead fees','unconvertedFeesCents'],['Net cash','netCents'],['Outstanding invoices, current','outstandingCents']].map(([label,key])=><Card key={key}><div>{label}</div><strong style={{fontSize:24}}>{dollars(report[key])}</strong></Card>)}</div><Card><p>Email report status: {report.emailStatus || "not sent"}</p><h3>Data completeness</h3><p>Undated historical payments: {dollars(report.undatedPaymentsCents)}</p><p>Undated expenses/materials: {dollars(report.undatedExpensesCents)}</p><p>Undated lead fees: {dollars(report.undatedLeadFeesCents)}</p><p>Leads without a known fee amount: {report.unknownLeadFeeCount}</p><p>Pending or unknown lead fees: {dollars(report.pendingLeadFeesCents)}</p><p>Lead fees dated when first observed charged: {dollars(report.observedLeadFeesCents)}</p><p>Undated and pending amounts are excluded from period totals. Add missing dates in payment, expense, or lead records.</p></Card>{!!report.gaps?.length && <Card>
 <h3>Records to review</h3>
 <ul className="queue-rows">{report.gaps.map(({type,id,invoiceId}) => {
  const labels = {"legacy-payment":"Date legacy payment","payment-date":"Correct payment date",balance:"Open invoice","expense-date":"Date job expenses","invoice-expense-date":"Date invoice expenses","material-date":"Date task materials","lead-fee":"Review lead fee"};
  const job = ctx?.getJob?.(id);
  const lead = ctx?.leads?.find(row => row.id === id);
  const open = () => {
   if (type === "lead-fee") return ctx.nav("leadRecord",id);
   if (type === "expense-date" || type === "material-date") return ctx.nav("jobSection",[id,type === "expense-date" ? "expenses" : "tasks"]);
   ctx.nav("jobInvoice",[id,invoiceId || "primary",type === "legacy-payment" ? "legacy" : type === "payment-date" ? "correction" : undefined]);
  };
  return <li key={JSON.stringify([type,id,invoiceId])} className="queue-row">
   <strong>{job?.title || lead?.title || lead?.name || id}{invoiceId && ` · ${job?.invoices?.find(row => row.id === invoiceId)?.name || "Invoice 1"}`}</strong>
   {ctx && <button type="button" className="admin-quiet" onClick={open}>{labels[type]}</button>}
  </li>;
 })}</ul>
 </Card>}</>}<p>Reports are emailed Monday at 8 a.m. and on the first of each month at 8 a.m. Pacific to shane@omnificology.com.</p></div>;
}
