/* eslint-disable require-jsdoc, max-len, @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import {isOwnerAuth} from "./ownerAuth";
import {dbForLeads, cents, Row} from "./leadWorkflow";
import {hash, OWNER_EMAIL, TIME_ZONE} from "./leadAutomationCore";
import {sendBrief, workspaceAccessToken} from "./leadAutomationGoogle";
import {paymentDateChange} from "@handy/shared/paymentDate";
import {cashReport, dayOf, periodRange} from "@handy/shared/finance";
import {buildJobInvoiceLines, totalCentsFromLines} from "./jobInvoiceLines";
import {invoicePaid, jobInvoices, PRIMARY_INVOICE_ID} from "@handy/shared/invoices";
const oauth = defineSecret("LEAD_AUTOMATION_GOOGLE_OAUTH");
export function validDate(v: unknown): string {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + "T12:00:00Z")) || new Date(s + "T12:00:00Z").toISOString().slice(0, 10) !== s) throw new HttpsError("invalid-argument", "A valid payment date is required.");
  return s;
}
export async function persistPayment(db: admin.firestore.Firestore, input: Row): Promise<Row> {
  const ref = db.doc(`payments/${hash(`${input.source}:${input.sourceId}`)}`); const jobRef = db.doc(`jobs/${input.jobId}`);
  return db.runTransaction(async (tx) => {
    const [old, job] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
    if (old.exists) {
      if (old.get("jobId") !== input.jobId || (old.get("invoiceId") || PRIMARY_INVOICE_ID) !== (input.invoiceId || PRIMARY_INVOICE_ID)) throw new HttpsError("invalid-argument", "Payment key belongs to another invoice.");
      if (input.source === "manual" && (old.get("amountCents") !== input.amountCents || !!old.get("historical") !== !!input.historical ||
        (old.get("dateCorrections")?.[0]?.previousDate || old.get("date")) !== input.date)) {
        throw new HttpsError("failed-precondition", "This transaction key has already been recorded with different values.");
      }
      return old.data() || {};
    }
    if (!job.exists) throw new HttpsError("not-found", "Job not found.");
    const invoiceId = input.invoiceId || PRIMARY_INVOICE_ID;
    const jobData = job.data() || {};
    const invoices = jobInvoices(jobData);
    if (!invoices.some(i => i.id === invoiceId)) throw new HttpsError("not-found", "Invoice not found.");
    const invoicePrevious = Math.round(invoicePaid(jobData, invoiceId) * 100);
    const tracked = input.historical ? await tx.get(db.collection("payments").where("jobId", "==", input.jobId)) : null;
    const previous = Math.round(Number(job.get("amountPaid") || 0) * 100);
    if (!Number.isSafeInteger(input.amountCents) || !input.amountCents) throw new HttpsError("invalid-argument", "A nonzero amount is required.");
    if (previous + input.amountCents < 0) throw new HttpsError("invalid-argument", "Refund exceeds recorded payments.");
    if (!input.historical && invoicePrevious + input.amountCents < 0) throw new HttpsError("invalid-argument", "Refund exceeds payments for this invoice.");
    const total = totalCentsFromLines(buildJobInvoiceLines(job.data() || {}));
    if (input.historical && (input.amountCents < 0 || input.amountCents > invoicePrevious - (tracked?.docs.filter(d => (d.get("invoiceId") || PRIMARY_INVOICE_ID) === invoiceId).reduce((n, d) => n + Number(d.get("amountCents") || 0), 0) || 0))) throw new HttpsError("invalid-argument", "Amount exceeds undated recorded payments.");
    const paid = input.historical ? previous : previous + input.amountCents;
    const data = {...input, invoiceId, createdAt: admin.firestore.FieldValue.serverTimestamp()};
    const invoicePaidCents = input.historical ? invoicePrevious : invoicePrevious + input.amountCents;
    const invoicePayments = {...jobData.invoicePaid, [invoiceId]: invoicePaidCents / 100};
    tx.create(ref, data); tx.update(jobRef, {invoicePaid: invoicePayments, amountPaid: paid / 100, payStatus: total > 0 && paid >= total ? "Paid" : paid > 0 ? "Partial" : "Unpaid", updatedAt: admin.firestore.FieldValue.serverTimestamp()});
    return data;
  });
}
export const recordJobPayment = onCall(async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const data = request.data || {}; const amount = cents(data.amount); const sourceId = String(data.idempotencyKey || "");
  if (!amount || !/^[a-zA-Z0-9_-]{12,100}$/.test(sourceId) || !/^[\w-]{1,150}$/.test(String(data.jobId || ""))) throw new HttpsError("invalid-argument", "Valid job, amount and transaction key required.");
  return persistPayment(dbForLeads(), {jobId: data.jobId, invoiceId: String(data.invoiceId || PRIMARY_INVOICE_ID), source: "manual", sourceId, amountCents: data.refund ? -amount : amount, date: validDate(data.date), historical: !!data.historical, method: String(data.method || "other").slice(0, 100)});
});
export async function persistPaymentDate(db: admin.firestore.Firestore, input: {paymentId: string; jobId: string; invoiceId: string; date: string; expectedDate: string | null; reason: string}): Promise<void> {
  const ref = db.doc(`payments/${input.paymentId}`);
  await db.runTransaction(async tx => {
    const payment = (await tx.get(ref)).data();
    if (!payment) throw new HttpsError("not-found", "Payment unavailable.");
    let change;
    try { change = paymentDateChange(payment, input); }
    catch (error) { throw new HttpsError("failed-precondition", (error as Error).message); }
    if (!change) return;
    tx.update(ref, {date: change.date, dateCorrections: admin.firestore.FieldValue.arrayUnion({
      ...change, at: new Date().toISOString(),
    })});
  });
}
export const correctJobPaymentDate = onCall(async request => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const d = request.data || {};
  if (![d.paymentId, d.jobId, d.invoiceId].every(value => typeof value === "string" && /^[\w-]{1,150}$/.test(value))) {
    throw new HttpsError("invalid-argument", "Valid payment, job and invoice required.");
  }
  await persistPaymentDate(dbForLeads(), {
    paymentId: d.paymentId, jobId: d.jobId, invoiceId: d.invoiceId, date: validDate(d.date),
    expectedDate: d.expectedDate == null ? null : validDate(d.expectedDate), reason: String(d.reason || "").slice(0, 1000),
  });
  return {ok: true};
});
export const recordLeadCost = onCall(async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const d = request.data || {}; const amount = cents(d.amount); const date = validDate(d.date);
  if (amount === null || !/^\d{1,30}$/.test(String(d.leadId || "")) || !/^[\w-]{12,100}$/.test(String(d.idempotencyKey || ""))) throw new HttpsError("invalid-argument", "Lead, amount and transaction key required.");
  const db = dbForLeads(); const ref = db.doc(`leadCosts/${d.confirmCostId && /^[a-f0-9]{64}$/.test(d.confirmCostId) ? d.confirmCostId : hash(`${d.leadId}:${d.idempotencyKey}`)}`);
  await db.runTransaction(async (tx) => {
    const [old, lead] = await Promise.all([tx.get(ref), tx.get(db.doc(`leads/${d.leadId}`))]);
    if (!lead.exists) throw new HttpsError("not-found", "Lead not found.");
    if (d.confirmCostId) {
      if (!old.exists || old.get("leadId") !== d.leadId || old.get("type") !== (d.refund ? "refund" : "charge")) throw new HttpsError("failed-precondition", "Cost does not belong to this lead.");
      tx.update(ref, {amountCents: amount, status: "charged", occurredAt: date, dateBasis: "owner",
        corrections: admin.firestore.FieldValue.arrayUnion({at: new Date().toISOString(),
          previousAmountCents: old.get("amountCents") ?? null, previousDate: dayOf(old.get("occurredAt")),
          previousStatus: old.get("status") ?? null, amountCents: amount, date}),
      });
    } else if (!old.exists) tx.create(ref, {leadId: d.leadId, type: d.refund ? "refund" : "charge", amountCents: amount, status: "charged", occurredAt: date, dateBasis: "owner", createdAt: admin.firestore.FieldValue.serverTimestamp()});
  });
  return {ok: true};
});
export async function reportData(db: admin.firestore.Firestore): Promise<Row> {
  const collections = await Promise.all(["jobs", "payments", "leadCosts", "leads"].map((c) => db.collection(c).get()));
  return Object.fromEntries(["jobs", "payments", "costs", "leads"].map((k, i) => [k, collections[i].docs.map((d) => ({id: d.id, ...d.data()}))]));
}
export const getFinancialReport = onCall(async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const range = periodRange(request.data?.kind === "week" ? "week" : "month", validDate(request.data?.date));
  const data = cashReport(await reportData(dbForLeads()), range);
  const run = await dbForLeads().doc(`financialReportRuns/${request.data?.kind === "week" ? "week" : "month"}-${range.start}`).get();
  return {...data, emailStatus: run.get("status") || "not_sent"};
});
export async function emailFinancialReport(kind: string): Promise<void> {
  const db = dbForLeads(); const range = periodRange(kind, new Date(), true); const key = `${kind}-${range.start}`;
  const ref = db.doc(`financialReportRuns/${key}`); const existing = await ref.get();
  if (["sent", "sending", "delivery_unknown"].includes(existing.get("status"))) return;
  const data = cashReport(await reportData(db), range); const dollar = (n: number): string => `$${(n / 100).toFixed(2)}`;
  const body = [`Handy ${kind} report: ${range.start} through ${dayOf(new Date(Date.parse(range.end + "T12:00:00Z") - 86400000))}`, "Pacific dates; cash collected less recorded costs.",
    `Collected: ${dollar(data.collectedCents)}`, `Expenses: ${dollar(data.expenseCents)}`, `Lead fees (net): ${dollar(data.leadFeesCents)}`, `Converted leads: ${dollar(data.convertedFeesCents)}`, `Unconverted leads: ${dollar(data.unconvertedFeesCents)}`, `Net cash: ${dollar(data.netCents)}`, `Outstanding invoices (current): ${dollar(data.outstandingCents)}`,
    `Undated historical payments: ${dollar(data.undatedPaymentsCents)}; expenses: ${dollar(data.undatedExpensesCents)}; lead fees: ${dollar(data.undatedLeadFeesCents)}. These are excluded from period totals.`, `Pending/unknown lead fees: ${dollar(data.pendingLeadFeesCents)}.`, `Lead fees dated when first observed charged: ${dollar(data.observedLeadFeesCents)}.`, "Open Handy: https://handy.omnificology.com/admin/reports"].join("\n");
  const token = await workspaceAccessToken(oauth.value());
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref); if (["sent", "sending", "delivery_unknown"].includes(s.get("status"))) return false; tx.set(ref, {status: "sending", recipient: OWNER_EMAIL, range, body, createdAt: admin.firestore.FieldValue.serverTimestamp()}); return true;
  });
  if (!claimed) return;
  try {
    const messageId = await sendBrief(token, `Handy ${kind} financial report — ${range.start}`, body, `finance-${key}`); await ref.update({status: "sent", messageId});
  } catch {
    await ref.update({status: "delivery_unknown"}); throw new Error("financial_report_delivery_unknown");
  }
}
export const emailWeeklyFinancialReport = onSchedule({schedule: "0 8 * * 1", timeZone: TIME_ZONE, secrets: [oauth], timeoutSeconds: 300}, async () => emailFinancialReport("week"));
export const emailMonthlyFinancialReport = onSchedule({schedule: "0 8 1 * *", timeZone: TIME_ZONE, secrets: [oauth], timeoutSeconds: 300}, async () => emailFinancialReport("month"));
