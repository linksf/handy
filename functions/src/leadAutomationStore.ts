/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {hash, IncomingEvent} from "./leadAutomationCore";

export const THREADS = "thumbtackConversations";

export async function saveLeadEvent(
  db: admin.firestore.Firestore,
  event: Exclude<IncomingEvent, {kind: "ignored"}>,
  leadFacts?: Record<string, unknown>,
): Promise<void> {
  const ref = db.collection(THREADS).doc(hash(event.leadId));
  // A conversation may already have a customer/job from before message capture existed.
  // Recover the initial job context, but flag missing historical messages for review.
  if (event.kind === "message" && !(await ref.get()).get("lead")) {
    const canonical = await db.collection("leads").doc(event.leadId).get();
    if (canonical.exists) leadFacts = {name: canonical.get("name") || "", address: canonical.get("address") || "", phone: canonical.get("phone") || "", email: canonical.get("email") || "", jobTitle: canonical.get("title") || "", jobInfo: canonical.get("description") || "", initialEstimate: canonical.get("initialEstimate") || {}, durationDetails: canonical.get("durationDetails") || {}, ...(canonical.get("jobId") ? {jobId: canonical.get("jobId"), customerId: canonical.get("customerId")} : {})};
    const jobs = await db.collection("jobs").where("sourceThumbtackLeadId", "==", event.leadId).limit(1).get();
    if (!leadFacts && !jobs.empty) {
      const job = jobs.docs[0];
      const customerId = String(job.get("customerId") || "");
      const inviteToken = String(job.get("leadInviteToken") || "");
      const customer = customerId ? await db.collection("customers").doc(customerId).get() : null;
      const invite = inviteToken ? await db.collection("leadInvites").doc(inviteToken).get() : null;
      leadFacts = {
        name: customer?.get("name") || "", address: customer?.get("address") || "",
        phone: customer?.get("phone") || "", jobTitle: job.get("title") || "",
        jobInfo: invite?.get("jobNotes") || "", jobId: job.id, customerId,
        initialEstimate: {hours: job.get("hours") || ""},
        historicalMessagesMissing: true,
      };
    }
  }
  const key = event.kind === "message" ? `message-${hash(event.message.id)}` : "initial-lead";
  const item = ref.collection("events").doc(key);
  await db.runTransaction(async (tx) => {
    const [old, existing] = await Promise.all([tx.get(ref), tx.get(item)]);
    if (existing.exists) return;
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.create(item, event.kind === "message" ? {
      kind: "message", ...event.message, receivedAt: now,
    } : {kind: "lead", receivedAt: now, payload: event.payload, ...(leadFacts ? {leadFacts} : {})});
    tx.set(ref, {
      leadId: event.leadId, dirty: true, nextAttemptAt: admin.firestore.Timestamp.fromMillis(0),
      version: Number(old.get("version") || 0) + 1,
      updatedAt: now,
      ...(!old.exists ? {createdAt: now} : {}),
      ...(leadFacts && (event.kind === "lead" || !old.get("lead")) ? {lead: leadFacts} : {}),
    }, {merge: true});
  });
}
