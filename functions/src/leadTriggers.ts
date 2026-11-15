/* eslint-disable require-jsdoc, max-len */
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {dbForLeads, leadFeeExpenses} from "./leadWorkflow";
import {hash} from "./leadAutomationCore";
import * as admin from "firebase-admin";
export const refreshLeadFeeExpense = onDocumentWritten("leadCosts/{costId}", async (event) => {
  const leadId = event.data?.after.get("leadId") || event.data?.before.get("leadId");
  if (!leadId) return;
  const db = dbForLeads();
  await db.runTransaction(async (tx) => {
    const lead = await tx.get(db.doc(`leads/${leadId}`));
    if (!lead.get("jobId")) return;
    const jobRef = db.doc(`jobs/${lead.get("jobId")}`);
    const [job, costs] = await Promise.all([tx.get(jobRef), tx.get(db.collection("leadCosts").where("leadId", "==", leadId))]);
    if (job.exists) tx.update(jobRef, {expenses: leadFeeExpenses(job.get("expenses") || [], costs.docs.map((d) => d.data()), leadId)});
  });
});
export const refreshLeadFacts = onDocumentWritten("leads/{leadId}", async (event) => {
  const before = event.data?.before.data(); const after = event.data?.after.data();
  if (!before || !after?.payloadFingerprint || before.payloadFingerprint === after.payloadFingerprint) return;
  const db = dbForLeads(); const ref = db.doc(`thumbtackConversations/${hash(event.params.leadId)}`);
  await db.runTransaction(async (tx) => {
    const thread = await tx.get(ref);
    if (!thread.exists || thread.get("leadPayloadFingerprint") === after.payloadFingerprint) return;
    tx.update(ref, {lead: {...thread.get("lead"), name: after.name, phone: after.phone, email: after.email, address: after.address, jobInfo: after.description, jobTitle: after.title, initialEstimate: after.initialEstimate, durationDetails: after.durationDetails},
      leadPayloadFingerprint: after.payloadFingerprint, version: Number(thread.get("version") || 0) + 1, dirty: true, nextAttemptAt: admin.firestore.Timestamp.fromMillis(0)});
  });
});
