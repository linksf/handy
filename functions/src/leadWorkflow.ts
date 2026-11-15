/* eslint-disable require-jsdoc, max-len, valid-jsdoc, @typescript-eslint/no-explicit-any */
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {generateOpaqueCustomerId, isOpaqueCustomerId} from "@handy/shared";
import {hash, Assessment, calendarBlockReason, TIME_ZONE} from "./leadAutomationCore";
import {generateInviteToken, normalizePhoneDigits} from "./leadInvite";
import {isOwnerAuth} from "./ownerAuth";
export type Row = Record<string, any>;
export const dbForLeads = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
};
const stamp = (): admin.firestore.FieldValue => admin.firestore.FieldValue.serverTimestamp();
export const cents = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return Number.isSafeInteger(n) ? n : null;
};
export function chargeState(value: unknown): string {
  const s = String(value || "").toLowerCase();
  if (/refund/.test(s)) return "refunded";
  if (/^(charged|paid|billed|completed|succeeded)$/.test(s)) return "charged";
  return /pending/.test(s) ? "pending" : "unknown";
}
export async function ingestLead(db: admin.firestore.Firestore, leadId: string, parsed: Row, payload: Row): Promise<Row> {
  const ref = db.doc(`leads/${leadId}`);
  const token = generateInviteToken();
  const fingerprint = hash(JSON.stringify(payload));
  const reservedId = isOpaqueCustomerId(parsed.thumbtackCustomerId) ? parsed.thumbtackCustomerId : generateOpaqueCustomerId();
  return db.runTransaction(async (tx) => {
    const old = await tx.get(ref);
    const identityRef = db.doc(`leadCustomerIdentities/${hash(String(parsed.thumbtackCustomerId || `lead:${leadId}`))}`);
    const identity = await tx.get(identityRef);
    const matches = parsed.thumbtackCustomerId ? await tx.get(db.collection("customers").where("thumbtackCustomerId", "==", parsed.thumbtackCustomerId).limit(2)) : null;
    const feeRef = db.doc(`leadCosts/${hash(`${leadId}:fee`)}`);
    const refundRef = db.doc(`leadCosts/${hash(`${leadId}:refund`)}`);
    const [fee, refund] = await Promise.all([tx.get(feeRef), tx.get(refundRef)]);
    if (old.get("payloadFingerprint") === fingerprint) return {...old.data(), id: leadId, duplicate: true};
    const inviteToken = old.get("inviteToken") || token;
    const sourceCreatedAt = Number.isFinite(Date.parse(payload.createdAt)) ? admin.firestore.Timestamp.fromDate(new Date(payload.createdAt)) : null;
    const state = chargeState(payload.chargeState);
    const amount = cents(parsed.expenses?.[0]?.amount || payload.leadPrice);
    const data = {source: "thumbtack", sourceLeadId: leadId, sourceCustomerId: parsed.thumbtackCustomerId || "", reservedCustomerId: old.get("reservedCustomerId") || identity.get("customerId") || (matches?.size === 1 ? matches.docs[0].id : reservedId), identityReview: (matches?.size || 0) > 1,
      name: parsed.name, phone: parsed.phone, email: parsed.email, address: parsed.address, title: parsed.jobTitle, description: parsed.clientJobNotes, customerNotes: parsed.customerNotes,
      initialEstimate: {price: parsed.price, hourlyRate: parsed.hourlyRate, hours: parsed.hours}, durationDetails: payload.request || payload.details || {},
      payload, payloadFingerprint: fingerprint, sourceCreatedAt, inviteToken, costState: state, costCents: amount,
      status: old.get("status") || "active", updatedAt: stamp(), ...(!old.exists ? {createdAt: stamp()} : {})};
    tx.set(ref, data, {merge: true});
    if (!identity.exists && !data.identityReview) tx.set(identityRef, {customerId: data.reservedCustomerId, sourceCustomerId: parsed.thumbtackCustomerId || ""});
    tx.set(db.doc(`leadInvites/${inviteToken}`), {token: inviteToken, leadId, sourceThumbtackLeadId: leadId, source: "thumbtack", customerId: old.get("customerId") || null, jobId: old.get("jobId") || null,
      name: parsed.name, phone: parsed.phone, phoneNormalized: normalizePhoneDigits(parsed.phone), email: parsed.email, address: parsed.address, jobTitle: parsed.jobTitle, jobNotes: parsed.clientJobNotes,
      thumbtackCustomerId: parsed.thumbtackCustomerId || "", ...(!old.exists ? {status: "open", clientUid: null, createdAt: stamp()} : {}), updatedAt: stamp()}, {merge: true});
    if (amount !== null) {
      const providedDate = payload.chargedAt || payload.chargeDate;
      const occurredAt = providedDate && Number.isFinite(Date.parse(providedDate)) ? admin.firestore.Timestamp.fromDate(new Date(providedDate)) : (state === "charged" || fee.get("status") === "charged") ? (fee.get("occurredAt") || admin.firestore.Timestamp.now()) : null;
      tx.set(feeRef, {leadId, type: "charge", amountCents: amount, status: state === "refunded" && fee.get("status") === "charged" ? "charged" : state === "refunded" ? "unknown" : fee.get("status") === "charged" && state !== "charged" ? "charged" : state,
        occurredAt, dateBasis: providedDate ? "source" : "observed", updatedAt: stamp()}, {merge: true});
      if (state === "refunded" && !refund.exists) tx.set(refundRef, {leadId, type: "refund", amountCents: amount, status: "charged", occurredAt: admin.firestore.Timestamp.now(), dateBasis: "observed", createdAt: stamp()});
    }
    return {...old.data(), ...data, id: leadId, inviteToken};
  });
}
export function mergedTasks(existing: Row[], proposals: Row[], library: Row[], priorKeys: string[] = []): {tasks: Row[]; review: string[]} {
  const result = [...existing]; const review: string[] = [];
  for (const proposed of proposals) {
    const name = String(proposed.name || "").trim();
    if (!name) continue;
    const key = hash(name.toLowerCase());
    const template = library.find((t) => t.id === proposed.taskDefId || String(t.name).toLowerCase() === name.toLowerCase());
    const current = result.find((t) => t.aiKey === key || t.name.toLowerCase() === name.toLowerCase());
    if (current?.source === "ai" && current.name === current.aiOriginalName && current.description === (current.aiOriginalDescription || "")) {
      const index = result.indexOf(current); result[index] = {...current, description: proposed.description || "", aiOriginalDescription: proposed.description || "", evidence: proposed.evidence || []};
    }
    if (!current && !priorKeys.includes(key)) result.push({id: `ai-${key.slice(0, 20)}`, aiKey: key, aiOriginalName: name, aiOriginalDescription: proposed.description || "", name, description: proposed.description || "", taskDefId: template?.id || "", toolIds: template?.toolIds || [], materials: [], evidence: proposed.evidence || [], source: "ai"});
  }
  for (const task of existing.filter((t) => t.source === "ai")) {
    if (!proposals.some((p) => hash(String(p.name).trim().toLowerCase()) === task.aiKey)) review.push(`Review existing task: ${task.name}; it is no longer in the latest agreed scope.`);
  }
  return {tasks: result, review};
}
export function leadFeeExpenses(existing: Row[], costs: Row[], leadId: string): Row[] {
  const total = costs.filter((c) => c.status === "charged").reduce((sum, c) => sum + (c.type === "refund" ? -1 : 1) * c.amountCents, 0);
  const rest = existing.filter((e) => e.id !== "thumbtack-lead-fee" && e.leadCostLeadId !== leadId);
  if (costs.some((c) => c.status === "charged")) rest.push({id: "thumbtack-lead-fee", leadCostLeadId: leadId, type: "Referral Fee", name: "Thumbtack lead fee (net of refunds)", amount: (total / 100).toFixed(2), reimbursable: false, datePaid: "", managed: true});
  return rest;
}
/** Firestore promotion is repeat-safe; external calendar state is repaired separately. */
export async function promoteLead(db: admin.firestore.Firestore, leadId: string, assessment: Assessment, booking: Row | null, calendar: Row | null, expectedVersion?: number): Promise<Row> {
  const reason = calendarBlockReason(assessment, new Date());
  if (reason) throw new Error("lead_not_ready_for_conversion");
  const ref = db.doc(`leads/${leadId}`); const threadRef = db.doc(`thumbtackConversations/${hash(leadId)}`);
  const [templates, fees] = await Promise.all([db.collection("tasks").get(), db.collection("leadCosts").where("leadId", "==", leadId).get()]);
  return db.runTransaction(async (tx) => {
    const [lead, thread, intake] = await Promise.all([
      tx.get(ref), tx.get(threadRef), tx.get(db.doc(`adminIntake/lead:${leadId}`)),
    ]);
    if (!lead.exists) throw new Error("canonical_lead_missing");
    if (lead.get("identityReview") && !intake.get("customerId")) throw new Error("customer_identity_review_required");
    if (["archived", "lost"].includes(lead.get("status")) && assessment.appointment.status !== "cancelled") throw new Error("lead_inactive_review_required");
    if (expectedVersion !== undefined && Number(thread.get("version")) !== expectedVersion) throw new Error("conversation_changed_retry");
    const linkedJobId = intake.get("jobId") || lead.get("jobId");
    const jobId = linkedJobId || `thumbtack-${hash(leadId).slice(0, 28)}`;
    if (assessment.appointment.status === "cancelled" && !linkedJobId) return {jobId: null};
    const customerId = intake.get("customerId") || lead.get("customerId") || lead.get("reservedCustomerId");
    const jobRef = db.doc(`jobs/${jobId}`); const customerRef = db.doc(`customers/${customerId}`);
    const [job, customer] = await Promise.all([tx.get(jobRef), tx.get(customerRef)]);
    const requestRef = booking?.requestId ? db.doc(`bookingRequests/${booking.requestId}`) : null;
    const submitted = requestRef ? await tx.get(requestRef) : null;
    const invite = lead.get("inviteToken") ? await tx.get(db.doc(`leadInvites/${lead.get("inviteToken")}`)) : null;
    const availability = requestRef ? await tx.get(db.collection("availability").where("status", "==", "open")) : null;
    const requests = requestRef ? await tx.get(db.collection("bookingRequests").where("status", "in", ["pending", "approved"])) : null;
    if (submitted && (!submitted.exists || submitted.get("status") === "declined" || submitted.get("sourceThumbtackLeadId") !== leadId)) throw new Error("booking_request_inactive");
    if (requests?.docs.some((r) => r.id !== booking?.requestId && r.get("requestedStart")?.toMillis() < Date.parse(assessment.appointment.end || "") && r.get("requestedEnd")?.toMillis() > Date.parse(assessment.appointment.start || ""))) throw new Error("booking_conflict_review_required");
    if (intake.get("jobId") && (!job.exists || !customer.exists || job.get("customerId") !== customerId)) {
      throw new Error("owner_intake_link_review_required");
    }
    const j = job.data() || {};
    const previousVisits: Row[] = j.visits || [];
    const active = previousVisits.find((v) => booking?.requestId && v.requestId === booking.requestId) || previousVisits.find((v) => v.id === j.activeVisitId);
    const isNewVisit = !active || (booking?.requestId && active.requestId !== booking.requestId) || (active.status !== "cancelled" && Date.parse(active.end) < Date.now() && assessment.appointment.start !== active.start) || (active.status === "cancelled" && assessment.appointment.status !== "cancelled");
    if (active?.revision && (["deferred", "cancelled"].includes(active.status) || !isNewVisit)) throw new Error("owner_edited_visit_review_required");
    const visitId = isNewVisit ? hash(`${leadId}:${assessment.appointment.start}:${active?.id || "first"}`).slice(0, 24) : active.id;
    const visit = {id: visitId, address: assessment.address || "", requestId: booking?.requestId || null, kind: assessment.appointment.kind, start: assessment.appointment.start || active?.start || null, end: assessment.appointment.end || active?.end || null,
      status: assessment.appointment.status === "cancelled" ? "cancelled" : "scheduled", durationMinutes: booking?.minutes || null, calendarEventId: calendar?.eventId || active?.calendarEventId || null};
    const tasks = mergedTasks(j.tasks || [], assessment.tasks || [], templates.docs.map((d) => ({id: d.id, ...d.data()})), j.aiGeneratedTaskKeys || []);
    const visits = [...previousVisits.filter((v) => v.id !== visitId), visit];
    const allCancelled = visits.every((v) => v.status === "cancelled");
    if (!customer.exists) tx.create(customerRef, {name: assessment.clientName || lead.get("name"), address: assessment.address || lead.get("address") || "", phone: lead.get("phone") || "", email: lead.get("email") || "", notes: lead.get("customerNotes") || "", thumbtackCustomerId: lead.get("sourceCustomerId") || "", clientUid: submitted?.get("clientUid") || invite?.get("clientUid") || null, status: "active", createdAt: stamp()});
    if (customer.exists && ["preliminary", "archived"].includes(customer.get("status"))) {
      tx.update(customerRef, {status: "active", ...(assessment.address && customer.get("address") === lead.get("address") ? {address: assessment.address} : {})});
    }
    const equipment = assessment.equipment || [];
    tx.set(jobRef, {...(!job.exists ? {title: assessment.jobSummary.split("\n")[0].slice(0, 140), price: "", hourlyRate: "", hours: "", notes: "", amountPaid: 0, payStatus: "Unpaid", createdAt: stamp()} : {}),
      jobAddress: intake.get("jobId") ? j.jobAddress || assessment.address || "" : assessment.address || "", customerId, leadId, source: lead.get("source") || "thumbtack", sourceThumbtackLeadId: leadId, leadInviteToken: lead.get("inviteToken") || "", bookingClientUid: j.bookingClientUid || submitted?.get("clientUid") || invite?.get("clientUid") || lead.get("clientUid") || null,
      status: allCancelled ? "Cancelled" : ["Complete", "In Progress"].includes(j.status) ? j.status : "Scheduled",
      date: assessment.appointment.start ? new Date(assessment.appointment.start).toLocaleDateString("en-CA", {timeZone: TIME_ZONE}) : j.date || "", visits, activeVisitId: visitId,
      tasks: tasks.tasks, aiGeneratedTaskKeys: [...new Set([...(j.aiGeneratedTaskKeys || []), ...(assessment.tasks || []).map((t) => hash(t.name.toLowerCase().trim()))])], aiScopeReview: tasks.review, aiSummary: assessment.jobSummary, aiEquipment: equipment,
      expenses: leadFeeExpenses(j.expenses || [], fees.docs.map((d) => d.data()), leadId), calendarSyncStatus: calendar ? "synced" : "pending", updatedAt: stamp()}, {merge: true});
    if (requestRef) tx.update(requestRef, {status: "approved", linkedJobId: jobId, updatedAt: stamp()});
    if (availability) {
      for (const slot of availability.docs) {
        if (slot.get("start")?.toMillis() < Date.parse(assessment.appointment.end || "") && slot.get("end")?.toMillis() > Date.parse(assessment.appointment.start || "")) tx.update(slot.ref, {status: "closed", sourceBookingRequestId: booking?.requestId});
      }
    }
    tx.set(ref, {jobId, customerId, legacyDraft: false, status: allCancelled ? "active" : "scheduled", updatedAt: stamp()}, {merge: true});
    tx.set(threadRef, {lead: {...thread.get("lead"), jobId, customerId}}, {merge: true});
    if (lead.get("inviteToken")) tx.set(db.doc(`leadInvites/${lead.get("inviteToken")}`), {jobId, customerId}, {merge: true});
    return {jobId, customerId, visitId};
  });
}
export const approveLeadBooking = onCall(async (request) => {
  if (!isOwnerAuth(request.auth)) throw new HttpsError("permission-denied", "Owner access required.");
  const db = dbForLeads(); const id = String(request.data?.requestId || "");
  const r = await db.doc(`bookingRequests/${id}`).get();
  const leadId = r.get("sourceThumbtackLeadId");
  if (!leadId || r.get("status") === "declined") throw new HttpsError("failed-precondition", "This is not an active Thumbtack booking request.");
  if (r.get("linkedJobId")) return {jobId: r.get("linkedJobId")};
  const start = r.get("requestedStart")?.toDate(); const end = r.get("requestedEnd")?.toDate();
  if (!start || !end || end <= start) throw new HttpsError("invalid-argument", "A valid visit time is required.");
  const a: Assessment = {clientName: r.get("clientName") || "Client", address: r.get("location") || "", jobSummary: r.get("title") || "Thumbtack visit", importantDetails: [], stage: "scheduled", needsReview: [],
    appointment: {status: "confirmed", kind: "job", start: start.toISOString(), end: end.toISOString(), evidence: []}, followUp: {owner: "none", reason: "", dueAt: null, evidence: []}};
  const result = await promoteLead(db, leadId, a, {minutes: (end - start) / 60000, requestId: id}, null);
  const thread = db.doc(`thumbtackConversations/${hash(leadId)}`);
  await db.runTransaction(async (tx) => {
    const t = await tx.get(thread); const fresh = await tx.get(r.ref);
    if (fresh.get("status") === "declined") throw new HttpsError("failed-precondition", "Request was declined.");
    const version = Number(t.get("version") || 0) + 1;
    for (const [suffix, sender, text] of [["client", "Customer", `I request ${start.toISOString()} to ${end.toISOString()} at ${a.address}: ${a.jobSummary}.`], ["owner", "Business", `Owner approved booking request ${id} for ${start.toISOString()} to ${end.toISOString()}.`]]) {
      tx.set(thread.collection("events").doc(`booking-${id}-${suffix}`), {id: `booking-${id}-${suffix}`, kind: "message", source: "booking_approval", leadId, sender, text, sentAt: new Date().toISOString()});
    }
    tx.update(thread, {version, dirty: true, nextAttemptAt: admin.firestore.Timestamp.fromMillis(0)});
    tx.update(r.ref, {status: "approved", linkedJobId: result.jobId, updatedAt: stamp()});
  });
  return result;
});

export async function refreshJobScope(db: admin.firestore.Firestore, leadId: string, assessment: Assessment, version: number): Promise<void> {
  const templates = await db.collection("tasks").get();
  await db.runTransaction(async (tx) => {
    const [lead, thread] = await Promise.all([tx.get(db.doc(`leads/${leadId}`)), tx.get(db.doc(`thumbtackConversations/${hash(leadId)}`))]);
    if (!lead.get("jobId") || lead.get("legacyDraft") || Number(thread.get("version")) !== version || ["lost", "cancelled"].includes(assessment.stage)) return;
    const jobRef = db.doc(`jobs/${lead.get("jobId")}`); const job = await tx.get(jobRef); if (!job.exists) return;
    const merged = mergedTasks(job.get("tasks") || [], assessment.tasks || [], templates.docs.map((d) => ({id: d.id, ...d.data()})), job.get("aiGeneratedTaskKeys") || []);
    tx.update(jobRef, {aiSummary: assessment.jobSummary, aiEquipment: assessment.equipment || [], tasks: merged.tasks, aiScopeReview: merged.review,
      aiGeneratedTaskKeys: [...new Set([...(job.get("aiGeneratedTaskKeys") || []), ...(assessment.tasks || []).map((t) => hash(t.name.toLowerCase().trim()))])]});
  });
}
