export const db = {};
export const auth = {};
export const functions = {};
export const authRecaptchaReady = Promise.resolve();
import { cashReport, moneyCents, periodRange } from "../../shared/finance.js";
import { buildJobInvoiceLines, invoicePaid, invoiceTotalFromLines, jobInvoices } from "../../shared/invoices.js";
import { pacificDay } from "../../src/utils/adminDates";
import { paymentDateChange } from "../../shared/paymentDate.js";
import { collection, doc, getDoc, getDocs, runTransaction, updateDoc } from "./firestore";

const attempts = new Set();
export const httpsCallable = (_functions, name) => async (input = {}) => {
  const { jobId, visitId, revision } = input;
  const rows = async name => (await getDocs(collection(db, name))).docs.map(row => ({ id: row.id, ...row.data() }));
  if (name === "draftAdminCapture") {
    return { data: input.kind === "receipt"
      ? { merchant: "Sample Hardware", date: pacificDay(new Date()), total: "72.50", review: "Synthetic extraction. Review the total and allocations." }
      : { transcript: "Added two brackets. Check alignment on the next visit.", proposedNote: "Installed two brackets. Recheck alignment next visit.",
          review: "Synthetic transcript for preview." } };
  }
  if (name === "getFinancialReport") {
    return { data: cashReport({ jobs: await rows("jobs"), payments: await rows("payments"), leads: await rows("leads"), costs: await rows("leadCosts") },
      periodRange(input.kind, input.date)) };
  }
  if (name === "correctJobPaymentDate") {
    const ref = doc(db, "payments", input.paymentId);
    await runTransaction(db, async transaction => {
      const payment = (await transaction.get(ref)).data();
      if (!payment) throw new Error("Payment unavailable.");
      const change = paymentDateChange(payment, input);
      if (change) transaction.update(ref, { date: change.date, dateCorrections: [...(payment.dateCorrections || []), change] });
    });
    return { data: { ok: true } };
  }
  if (name === "recordJobPayment") {
    const { invoiceId, refund, historical, date, idempotencyKey } = input;
    const paymentRef = doc(db, "payments", idempotencyKey);
    const jobRef = doc(db, "jobs", jobId);
    await runTransaction(db, async transaction => {
      const old = (await transaction.get(paymentRef)).data();
      if (old) return;
      const job = (await transaction.get(jobRef)).data();
      if (!job || !jobInvoices(job).some(row => row.id === invoiceId)) throw new Error("Invoice unavailable.");
      const amountCents = moneyCents(input.amount) * (refund ? -1 : 1);
      const prior = moneyCents(invoicePaid(job, invoiceId));
      const tracked = (await rows("payments")).filter(row => row.jobId === jobId && (row.invoiceId || "primary") === invoiceId)
        .reduce((sum, row) => sum + row.amountCents, 0);
      if (!amountCents || prior + amountCents < 0 || historical && (amountCents < 0 || amountCents > prior - tracked)) throw new Error("Invalid ledger amount.");
      const total = invoiceTotalFromLines(buildJobInvoiceLines(job));
      const amountPaid = ((moneyCents(job.amountPaid)) + (historical ? 0 : amountCents)) / 100;
      transaction.set(paymentRef, { jobId, invoiceId, amountCents, date, historical });
      transaction.update(jobRef, { amountPaid, payStatus: total > 0 && amountPaid >= total ? "Paid" : amountPaid > 0 ? "Partial" : "Unpaid",
        invoicePaid: { ...job.invoicePaid, [invoiceId]: (prior + (historical ? 0 : amountCents)) / 100 } });
    });
    return { data: { ok: true } };
  }
  if (name === "syncAdminVisit") {
    const ref = doc(db, "jobs", jobId);
    const job = (await getDoc(ref)).data();
    const visit = job?.visits?.find(item => item.id === visitId && item.revision === revision);
    if (!visit) throw new Error("Visit changed.");
    const fail = visit.kind === "Return visit" && !attempts.has(visitId) && !visit.calendarEventId;
    attempts.add(visitId);
    const status = fail
      ? { syncStatus: "failed", syncError: "Simulated calendar outage." }
      : { syncStatus: "synced", syncError: null, calendarEventId: visit.calendarEventId || `preview-${visitId}` };
    await updateDoc(ref, { visits: job.visits.map(item => item.id === visitId ? { ...item, ...status } : item) });
    return { data: status };
  }
  throw new Error("External services are disabled in the synthetic preview.");
};
const user = { uid: "fixture-owner", displayName: "Preview owner" };
export function useAuth() {
  return { user, loading: false, signOut: () => window.location.assign("/admin/dashboard") };
}

// A phone on the same LAN may open the synthetic preview over plain HTTP.
if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  };
}

export function useClientAuth() {
  const unavailable = async () => { throw new Error("Client sign-in is disabled in the synthetic preview."); };
  return { user: null, loading: false, signIn: unavailable, signUp: unavailable, signInWithGoogle: unavailable, signOut: unavailable };
}
