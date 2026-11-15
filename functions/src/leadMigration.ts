/* eslint-disable require-jsdoc, max-len, @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {dbForLeads, Row, cents, chargeState} from "./leadWorkflow";
import {generateOpaqueCustomerId} from "@handy/shared";
import {hash} from "./leadAutomationCore";
import {isOwnerAuth} from "./ownerAuth";
export function cleanupReasons(job: Row, sessions: number, invoices: number): string[] {
  const reasons: string[] = [];
  if (job.status !== "Draft") reasons.push("Job is no longer a lead-only draft.");
  if ((job.tasks || []).length) reasons.push("Job has tasks or manually prepared scope.");
  if (Number(job.amountPaid || 0) || job.payStatus !== "Unpaid") reasons.push("Job has payment history.");
  if (sessions || Number(job.hours || 0) && !/^Imported from Thumbtack webhook\./.test(job.notes || "")) reasons.push("Job has recorded work.");
  if (invoices || job.squareInvoiceId || job.firestoreInvoiceId) reasons.push("Job has an invoice.");
  if (job.updatedAt && job.createdAt && job.updatedAt.toMillis?.() > job.createdAt.toMillis?.()) reasons.push("Job was edited after creation; review it individually.");
  if (job.bookingClientUid || job.sourceBookingRequestId) reasons.push("Job has an active client or booking link.");
  if ((job.expenses || []).some((e: Row) => e.id !== "thumbtack-lead-fee")) reasons.push("Job has additional expenses.");
  return reasons;
}
export async function backfillLeads(db: admin.firestore.Firestore): Promise<Row> {
  const [jobs, customers, invites, threads, existing] = await Promise.all(["jobs", "customers", "leadInvites", "thumbtackConversations", "leads"].map((c) => db.collection(c).get()));
  const ids = new Set(existing.docs.map((d) => d.id)); const customerMap = new Map(customers.docs.map((d) => [d.id, d.data()]));
  const threadMap = new Map(threads.docs.map((d) => [d.get("leadId"), d.data()])); let created = 0; let candidates = 0;
  for (const job of jobs.docs.filter((d) => d.get("sourceThumbtackLeadId") && d.get("status") !== "Archived")) {
    const j = job.data(); const id = String(j.sourceThumbtackLeadId); const customer = customerMap.get(j.customerId) || {}; if (customer.name === "Test Customer") continue;
    const invite = invites.docs.find((i) => i.id === j.leadInviteToken)?.data() || {};
    const thread = threadMap.get(id) || {}; const fee = (j.expenses || []).find((e: Row) => e.id === "thumbtack-lead-fee");
    const feeCents = fee ? cents(fee.amount) : null; const state = chargeState(String(j.notes || "").match(/Lead charge: ([^\n]+)/)?.[1]);
    const hasAgreedVisit = ["Scheduled", "In Progress", "Complete", "Cancelled"].includes(j.status) || !!thread.calendar;
    if (!ids.has(id)) {
      await db.doc(`leads/${id}`).create({source: "thumbtack", sourceLeadId: id, sourceCustomerId: customer.thumbtackCustomerId || invite.thumbtackCustomerId || "", reservedCustomerId: j.customerId,
        customerId: j.customerId, jobId: job.id, legacyDraft: !hasAgreedVisit, name: customer.name || invite.name || "", phone: customer.phone || invite.phone || "", email: customer.email || invite.email || "", address: customer.address || invite.address || "",
        title: j.title || invite.jobTitle || "Thumbtack lead", description: invite.jobNotes || thread.lead?.jobInfo || "", customerNotes: customer.notes || "", initialEstimate: thread.lead?.initialEstimate || {price: j.price || "", hourlyRate: j.hourlyRate || "", hours: j.hours || ""},
        status: hasAgreedVisit ? "scheduled" : ["lost", "cancelled"].includes(thread.assessment?.stage) ? "lost" : "active", assessment: thread.assessment || null, followUp: thread.assessment?.followUp || null, schedulingReview: thread.calendarReview || null,
        costState: state, costCents: feeCents, inviteToken: j.leadInviteToken || "", rawWebhookUnavailable: true, createdAt: j.createdAt || admin.firestore.Timestamp.now(), sourceCreatedAt: null, migratedAt: admin.firestore.FieldValue.serverTimestamp()});
      ids.add(id); created++;
    }
    if (feeCents !== null) {
      const ref = db.doc(`leadCosts/${hash(`${id}:fee`)}`);
      if (!(await ref.get()).exists) await ref.create({leadId: id, type: "charge", amountCents: feeCents, status: state, occurredAt: fee.datePaid || null, dateBasis: fee.datePaid ? "legacy_recorded" : "unknown", legacyJobId: job.id});
    }
    if (hasAgreedVisit) {
      const review = await db.doc(`leadCleanupReview/${job.id}`).get();
      if (review.exists && review.get("status") === "pending") await review.ref.update({status: "converted"});
    }
    if (!hasAgreedVisit) {
      const [sessions, invoices] = await Promise.all([job.ref.collection("workSessions").limit(1).get(), db.collection("invoices").where("jobId", "==", job.id).limit(1).get()]);
      await db.doc(`leadCleanupReview/${job.id}`).set({jobId: job.id, leadId: id, customerId: j.customerId, name: customer.name || "", title: j.title || "", reasons: [...cleanupReasons(j, sessions.size, invoices.size), ...(["completed"].includes(thread.assessment?.stage) || thread.assessment?.appointment?.status === "confirmed" ? ["Captured conversation includes an agreed or completed visit; review individually."] : [])], requiresIndividualReview: true, status: "pending", snapshotHash: hash(JSON.stringify(j)), preparedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true}); candidates++;
    }
  }
  // Preserve initial lead facts even when a historic job was deleted or never existed.
  for (const t of threads.docs) {
    const d = t.data(); if (ids.has(d.leadId) || !d.lead) continue;
    await db.doc(`leads/${d.leadId}`).create({source: "thumbtack", sourceLeadId: d.leadId, reservedCustomerId: d.lead.customerId || generateOpaqueCustomerId(), name: d.lead.name || "", phone: d.lead.phone || "", email: d.lead.email || "", address: d.lead.address || "", title: d.lead.jobTitle || "", description: d.lead.jobInfo || "", initialEstimate: d.lead.initialEstimate || {}, status: "active", assessment: d.assessment || null, createdAt: d.createdAt || admin.firestore.Timestamp.now(), costState: "unknown", costCents: null, rawWebhookUnavailable: true}); created++;
  }
  await db.doc("leadAutomationState/leadMigration").set({created, candidates, completedAt: admin.firestore.FieldValue.serverTimestamp()});
  return {created, candidates};
}
export const reviewLeadCleanup = onCall(async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  if (request.data?.action !== "archive" || request.data?.reviewed !== true) throw new HttpsError("invalid-argument", "Review confirmation required.");
  const db = dbForLeads(); const jobId = String(request.data.jobId || ""); const ref = db.doc(`jobs/${jobId}`); const reviewRef = db.doc(`leadCleanupReview/${jobId}`);
  await db.runTransaction(async (tx) => {
    const [job, review] = await Promise.all([tx.get(ref), tx.get(reviewRef)]); if (!job.exists || !review.exists) throw new HttpsError("not-found", "Review record missing.");
    if (review.get("status") === "archived") return;
    const [sessions, invoices, others, inquiries, customer, lead] = await Promise.all([tx.get(ref.collection("workSessions").limit(1)), tx.get(db.collection("invoices").where("jobId", "==", jobId).limit(1)), tx.get(db.collection("jobs").where("customerId", "==", job.get("customerId"))), tx.get(db.collection("inquiries").where("customerId", "==", job.get("customerId"))), tx.get(db.doc(`customers/${job.get("customerId")}`)), tx.get(db.doc(`leads/${review.get("leadId")}`))]);
    const conversation = await tx.get(db.doc(`thumbtackConversations/${hash(review.get("leadId"))}`));
    const reasons = cleanupReasons(job.data() || {}, sessions.size, invoices.size);
    if (conversation.get("assessment.stage") === "completed" || conversation.get("assessment.appointment.status") === "confirmed") reasons.push("Captured conversation includes an agreed or completed visit.");
    if (reasons.length || review.get("snapshotHash") !== hash(JSON.stringify(job.data()))) throw new HttpsError("failed-precondition", "Job has protected data or changed since review. Refresh the cleanup review.");
    tx.update(ref, {status: "Archived", archivedAt: admin.firestore.FieldValue.serverTimestamp()});
    tx.update(reviewRef, {status: "archived"});
    if (lead.get("jobId") === jobId) tx.update(lead.ref, {jobId: null, customerId: null, legacyDraft: false});
    if (customer.exists && customer.get("status") === "preliminary" && !customer.get("clientUid") && inquiries.empty && others.docs.every((j) => j.id === jobId || j.get("status") === "Archived")) tx.update(customer.ref, {status: "archived"});
  });
  return {ok: true};
});

export const prepareLeadCleanup = onCall({timeoutSeconds: 300}, async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  return backfillLeads(dbForLeads());
});
