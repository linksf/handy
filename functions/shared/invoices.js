export const PRIMARY_INVOICE_ID = 'primary';
const cents = value => Math.round((parseFloat(value) || 0) * 100);
export function jobInvoices(job) {
  const invoices = job.invoices || [];
  return invoices.some(i => i.id === PRIMARY_INVOICE_ID) ? invoices : [{id: PRIMARY_INVOICE_ID, name: 'Invoice 1'}, ...invoices];
}
export function invoicePaid(job, invoiceId) {
  const invoices = jobInvoices(job);
  if (invoiceId !== PRIMARY_INVOICE_ID) return Number(job.invoicePaid?.[invoiceId] ?? invoices.find(i => i.id === invoiceId)?.amountPaid) || 0;
  return (cents(job.amountPaid) - invoices.filter(i => i.id !== PRIMARY_INVOICE_ID).reduce((n, i) => n + cents(job.invoicePaid?.[i.id] ?? i.amountPaid), 0)) / 100;
}
/** Stable source keys allocate each charge to exactly one invoice; costs stay on the job. */
export function buildJobInvoiceLines(job, invoiceId, includeUnbilled = false) {
  const lines = [];
  const ids = new Set(jobInvoices(job).map(i => i.id));
  const add = (key, name, originalAmountCents, source = {}, billable = true, kind = 'item') => {
    const override = job.invoiceOverrides?.[key] || {};
    const comped = override.comped ?? !!source.comped;
    const assigned = override.invoiceId || source.invoiceId || PRIMARY_INVOICE_ID;
    const assignedId = ids.has(assigned) ? assigned : PRIMARY_INVOICE_ID;
    if (invoiceId && invoiceId !== assignedId) return;
    if (!billable && !comped && !includeUnbilled) return;
    lines.push({key, name, originalAmountCents, amountCents: comped || !billable ? 0 : originalAmountCents,
      comped, invoiceId: assignedId, billable: billable || comped, kind});
  };
  const title = (job.title || '').trim() || 'Job';
  if (cents(job.price) > 0) add('flat', `${title} — flat rate`, cents(job.price));
  const labor = (entry, key, fallback) => {
    const hours = Number(entry.hours), rate = Number(entry.hourlyRate);
    if (Number.isFinite(hours) && hours > 0 && Number.isFinite(rate) && rate >= 0)
      add(key, `${(entry.name || fallback).trim() || fallback} (${hours} hr × $${rate.toFixed(2)}/hr)`, Math.round(hours * rate * 100), entry, true, 'labor');
  };
  labor(job, 'labor', 'Labor');
  (job.laborEntries || []).forEach((entry, index) => labor(entry, `labor:${entry.id || index}`, 'Labor'));
  (job.expenses || []).forEach((entry, index) => {
    if (cents(entry.amount) > 0) add(`expense:${entry.id || index}`, entry.name || 'Expense', cents(entry.amount), entry, !!entry.reimbursable, 'expense');
  });
  (job.tasks || []).forEach((task, ti) => (task.materials || []).forEach((entry, mi) => {
    const amount = Math.round((parseFloat(entry.cost) || 0) * (parseFloat(entry.qty) || 1) * 100);
    if (amount > 0) add(`material:${task.id || ti}:${entry.id || mi}`, [task.name, entry.name || 'Materials'].filter(Boolean).join(': '), amount, entry, !!entry.reimbursable, 'expense');
  }));
  (job.invoiceItems || []).forEach(entry => {
    if (entry.kind === 'labor') labor(entry, `item:${entry.id}`, 'Labor');
    else if (cents(entry.amount) >= 0) add(`item:${entry.id}`, entry.name || 'Item', cents(entry.amount), entry, entry.kind !== 'expense' || !!entry.reimbursable, entry.kind);
  });
  return lines;
}
export const invoiceTotalFromLines = lines => lines.reduce((sum, line) => sum + line.amountCents, 0) / 100;
export const totalCentsFromLines = lines => lines.reduce((sum, line) => sum + line.amountCents, 0);
export function jobCostBreakdown(job) {
  let reimbursable = 0, nonReimbursable = 0;
  const add = (amount, entry) => { if (entry.reimbursable) reimbursable += amount; else nonReimbursable += amount; };
  (job.expenses || []).forEach(e => add(cents(e.amount) / 100, e));
  (job.tasks || []).forEach(t => (t.materials || []).forEach(m => add(Math.round((parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1) * 100) / 100, m)));
  (job.invoiceItems || []).filter(e => e.kind === 'expense').forEach(e => add(cents(e.amount) / 100, e));
  return {reimbursable, nonReimbursable, total: reimbursable + nonReimbursable};
}
