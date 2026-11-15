import { buildJobInvoiceLines, invoicePaid, invoiceTotalFromLines, jobInvoices } from "../../shared/invoices.js";
import { dayOf, moneyCents } from "../../shared/finance.js";

export function closeoutFor(job) {
  const openVisits = (job.visits || []).filter(visit => ["scheduled", "confirmed", "in_progress", "in progress", "deferred"].includes(visit.status));
  const invoices = jobInvoices(job).map(invoice => {
    const lines = buildJobInvoiceLines(job, invoice.id);
    return { ...invoice, total: invoiceTotalFromLines(lines), paid: invoicePaid(job, invoice.id),
      issued: !!job.issuedInvoices?.[invoice.id]?.length, hasLines: lines.length > 0 };
  }).filter(invoice => invoice.hasLines || invoice.paid);
  const expenses = (job.expenses || []).filter(row => moneyCents(row.amount) && !row.leadCostLeadId && row.id !== "thumbtack-lead-fee" && !dayOf(row.datePaid));
  const materials = (job.tasks || []).some(task => task.materials?.some(row => moneyCents(row.cost) && !dayOf(row.datePaid)));
  const invoiceExpenses = (job.invoiceItems || []).filter(row => row.kind === "expense" && moneyCents(row.amount) && !dayOf(row.datePaid));
  const complete = job.status === "Complete" || job.status === "Archived" && job.archivedFromStatus === "Complete";
  const issues = [
    ...(!complete ? ["Job completion"] : []),
    ...(openVisits.length ? ["Open visits"] : []),
    ...(!job.finalVisit && !job.visits?.some(visit => visit.status === "completed") ? ["Final visit outcome"] : []),
    ...invoices.filter(invoice => invoice.hasLines && !invoice.issued).map(invoice => `${invoice.name} issue`),
    ...invoices.filter(invoice => moneyCents(invoice.total) > moneyCents(invoice.paid)).map(invoice => `${invoice.name} balance`),
    ...(expenses.length || materials || invoiceExpenses.length ? ["Missing cost dates"] : []),
  ];
  return { openVisits, invoices, expenses, materials, invoiceExpenses, complete, issues };
}
