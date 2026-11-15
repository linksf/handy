import { buildJobInvoiceLines, jobInvoices, invoicePaid, totalCentsFromLines } from "./invoices.js";
export function hourlyLaborTotal(job) {
  return buildJobInvoiceLines(job).filter(line => line.kind === 'labor').reduce((sum, line) => sum + line.amountCents, 0) / 100;
}
const TZ = 'America/Los_Angeles';
export const dayOf = value => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value.toDate?.() || (value.seconds ? new Date(value.seconds * 1000) : new Date(value));
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric',month:'2-digit',day:'2-digit'}).format(d) : null;
};
export const moneyCents = n => Math.round((parseFloat(n) || 0) * 100);
const shift = (day,n) => {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export function periodRange(kind, anchor, previous=false) {
  const day=dayOf(anchor);if(!day)throw new Error('invalid_report_date');
  let start,end;
  if(kind==='week'){const dow=new Date(day+'T12:00:00Z').getUTCDay();start=shift(day,-((dow+6)%7));if(previous)start=shift(start,-7);end=shift(start,7);}
  else {let y=+day.slice(0,4),m=+day.slice(5,7)-1;if(previous)m--;start=new Date(Date.UTC(y,m,1,12)).toISOString().slice(0,10);end=new Date(Date.UTC(y,m+1,1,12)).toISOString().slice(0,10);}
  return {start,end};
}
export function cashReport({jobs=[],payments=[],costs=[],leads=[]}, range) {
  const inPeriod=d=>d&&d>=range.start&&d<range.end;
  const out={...range,collectedCents:0,expenseCents:0,leadFeesCents:0,convertedFeesCents:0,unconvertedFeesCents:0,netCents:0,outstandingCents:0,undatedPaymentsCents:0,undatedExpensesCents:0,undatedLeadFeesCents:0,pendingLeadFeesCents:0,observedLeadFeesCents:0,unknownLeadFeeCount:0};
  const gaps = out.gaps = [];
  const gap = (type, id, invoiceId = null) => gaps.push({type, id, invoiceId});
  const trackedByInvoice = new Map();
  for (const payment of payments) {
    const key = JSON.stringify([payment.jobId, payment.invoiceId || "primary"]);
    trackedByInvoice.set(key, (trackedByInvoice.get(key) || 0) + Number(payment.amountCents || 0));
    if (!dayOf(payment.date || payment.occurredAt)) gap("payment-date", payment.jobId, payment.invoiceId || "primary");
  }
  const hasJob=new Set(leads.filter(l=>l.jobId&&!l.legacyDraft).map(l=>l.id||l.sourceLeadId));
  for(const p of payments){const d=dayOf(p.date||p.occurredAt);if(!d)out.undatedPaymentsCents+=p.amountCents;else if(inPeriod(d))out.collectedCents+=p.amountCents;}
  const tracked=new Map();for(const p of payments)tracked.set(p.jobId,(tracked.get(p.jobId)||0)+p.amountCents);
  for(const j of jobs){
    const paid=moneyCents(j.amountPaid);out.undatedPaymentsCents+=Math.max(0,paid-(tracked.get(j.id)||0));
    for (const invoice of jobInvoices(j)) {
      const paidOnInvoice = moneyCents(invoicePaid(j, invoice.id));
      const tracked = trackedByInvoice.get(JSON.stringify([j.id, invoice.id])) || 0;
      if (paidOnInvoice > tracked) gap("legacy-payment", j.id, invoice.id);
      const due = totalCentsFromLines(buildJobInvoiceLines(j, invoice.id)) - paidOnInvoice;
      const status = j.status === "Archived" ? (j.archivedFromStatus || "Complete") : j.status;
      if (due > 0 && !["Draft", "Cancelled"].includes(status)) {
        out.outstandingCents += due;
        gap("balance", j.id, invoice.id);
      }
    }
    const expenses=[...(j.invoiceItems||[]).filter(e=>e.kind==='expense'),...(j.expenses||[]),...(j.tasks||[]).flatMap(t=>(t.materials||[]).map(m=>({...m,amount:(parseFloat(m.cost)||0)*(parseFloat(m.qty)||1)})))];
    for(const e of expenses){const amount=moneyCents(e.amount);if(e.leadCostLeadId||e.id==='thumbtack-lead-fee')continue;const d=dayOf(e.datePaid);if(!d)out.undatedExpensesCents+=amount;else if(inPeriod(d))out.expenseCents+=amount;}
    if (expenses.some(e => moneyCents(e.amount) && !e.leadCostLeadId && e.id !== "thumbtack-lead-fee" && !dayOf(e.datePaid))) {
      if ((j.expenses || []).some(e => moneyCents(e.amount) && !e.leadCostLeadId && e.id !== "thumbtack-lead-fee" && !dayOf(e.datePaid))) gap("expense-date", j.id);
      if ((j.invoiceItems || []).some(e => e.kind === "expense" && moneyCents(e.amount) && !dayOf(e.datePaid))) gap("invoice-expense-date", j.id);
      if ((j.tasks || []).some(task => (task.materials || []).some(e => moneyCents(e.cost) && !dayOf(e.datePaid)))) gap("material-date", j.id);
    }
  }
  const confirmedLeads = new Set(costs.filter(cost => cost.status === "charged" && cost.type === "charge").map(cost => cost.leadId));
  out.unknownLeadFeeCount = leads.filter(lead => lead.costCents == null && !confirmedLeads.has(lead.id)).length;
  for(const c of costs){if(c.status!=='charged'){out.pendingLeadFeesCents+=c.amountCents||0;continue;}const amount=(c.type==='refund'?-1:1)*c.amountCents;const d=dayOf(c.occurredAt);if(!d){out.undatedLeadFeesCents+=amount;continue;}if(inPeriod(d)){out.leadFeesCents+=amount;if(hasJob.has(c.leadId))out.convertedFeesCents+=amount;else out.unconvertedFeesCents+=amount;if(c.dateBasis==='observed')out.observedLeadFeesCents+=amount;}}
  for (const lead of leads) if (lead.costCents == null && !confirmedLeads.has(lead.id)) gap("lead-fee", lead.id);
  for (const cost of costs) if (cost.status !== "charged" || !dayOf(cost.occurredAt)) gap("lead-fee", cost.leadId);
  out.gaps = [...new Map(gaps.map(item => [JSON.stringify(item), item])).values()];
  out.netCents=out.collectedCents-out.expenseCents-out.leadFeesCents;return out;
}
