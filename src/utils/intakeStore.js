import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { generateOpaqueCustomerId } from "@handy/shared";

export async function saveIntakeAction(db, key, changes, type, evidence = {}) {
  return runTransaction(db, async transaction => {
    const ref = doc(db, "adminIntake", key);
    const previous = (await transaction.get(ref)).data() || {};
    const at = serverTimestamp();
    transaction.set(ref, { ...changes, updatedAt: at }, { merge: true });
    transaction.set(doc(ref, "history", crypto.randomUUID()), {
      type, at, previous: Object.fromEntries(Object.keys(changes).map(field => [field, previous[field] ?? null])), ...evidence,
    });
  });
}

export async function saveIntakeJob(db, { source, form, customer, existingJobId, tasks, reason, newJobId }) {
  const customerId = customer.id || generateOpaqueCustomerId();
  const ref = doc(db, "jobs", existingJobId || newJobId);
  const intakeRef = source && doc(db, "adminIntake", source.key);
  return runTransaction(db, async transaction => {
    const previous = intakeRef ? (await transaction.get(intakeRef)).data() || {} : {};
    let upstream;
    if (source) {
      const collectionName = { lead: "leads", inquiry: "inquiries", job: "jobs" }[source.kind];
      upstream = (await transaction.get(doc(db, collectionName, source.id))).data();
      if (!upstream) throw new Error("The original request is no longer available.");
      if (source.kind === "lead" && upstream.jobId && (previous.jobId || source.jobId) !== upstream.jobId) {
        throw new Error("This lead was linked while you were editing. Reopen the form to review its job.");
      }
    }
    if (!existingJobId && previous.jobId === newJobId) return newJobId;
    if ((previous.jobId || source?.jobId) && !existingJobId) {
      throw new Error("This request already has a job. Select Link existing job to review it.");
    }
    const oldJob = (await transaction.get(ref)).data();
    const priorLink = previous.jobId && previous.jobId !== ref.id
      ? doc(db, "jobs", previous.jobId) : null;
    const priorJob = priorLink ? (await transaction.get(priorLink)).data() : null;
    const oldCustomer = (await transaction.get(doc(db, "customers", customerId))).data();
    if (!existingJobId && oldJob) return ref.id;
    if (existingJobId && !oldJob) throw new Error("This job is no longer available.");
    if (source?.kind === "lead" && upstream.jobId && upstream.jobId !== ref.id) {
      throw new Error("The existing Thumbtack appointment uses another job. Review that record before relinking.");
    }
    if (source?.kind === "lead" && priorJob && (priorJob.visits?.length || priorJob.sourceBookingRequestId ||
      priorJob.status !== "Draft" || Number(priorJob.amountPaid) > 0 || priorJob.invoices?.length)) {
      throw new Error("This lead is linked to a job with scheduling or billing history. Review that job before changing the link.");
    }
    const customerChanged = oldJob && oldJob.customerId !== customerId;
    const canCorrectCustomer = source && oldJob && oldJob.status === "Draft" &&
      !oldJob.visits?.length && !oldJob.sourceBookingRequestId && !oldJob.bookingClientUid &&
      !Number(oldJob.amountPaid) && !oldJob.invoices?.length && !oldJob.invoiceItems?.length &&
      (previous.jobId === ref.id || source.jobId === ref.id) && reason;
    if (customerChanged && !canCorrectCustomer) {
      throw new Error("This job’s customer can only be reassigned from intake while it is an unbooked draft without invoice history.");
    }
    if (customer.id && (!oldCustomer || oldCustomer.status === "archived")) throw new Error("Choose an active customer.");
    if (!customer.id && oldCustomer) throw new Error("Customer ID collision. Please retry.");
    const at = serverTimestamp();
    if (!customer.id) transaction.set(doc(db, "customers", customerId), {
      name: customer.name, email: customer.email, phone: customer.phone, address: "", createdAt: at,
    });
    const sourceRef = source && { kind: source.kind, id: source.id };
    if (!oldJob) transaction.set(ref, {
      ...form, customerId, tasks, payStatus: "Unpaid", amountPaid: 0, createdAt: at,
      ...(sourceRef ? { intakeSource: sourceRef } : {}),
    });
    else if (source?.kind === "job" && source.id === existingJobId) {
      const { title, jobAddress, notes, siteContact, payer, estimate, approvedPrice } = form;
      transaction.set(ref, { title, jobAddress, notes, siteContact, payer, estimate, approvedPrice, customerId }, { merge: true });
    } else if (customerChanged) transaction.update(ref, { customerId });
    if (intakeRef) {
      if (priorJob?.intakeSource?.kind === source.kind && priorJob.intakeSource.id === source.id) {
        transaction.update(priorLink, { intakeSource: null });
      }
      if (oldJob && !oldJob.intakeSource) transaction.set(ref, { intakeSource: sourceRef }, { merge: true });
      transaction.set(intakeRef, { jobId: ref.id, customerId, group: "Ready to book", snoozeUntil: null, updatedAt: at }, { merge: true });
      transaction.set(doc(intakeRef, "history", crypto.randomUUID()), {
        type: oldJob ? "link job" : "create job", at, source: sourceRef, reason,
        previousJobId: previous.jobId || source.jobId || null,
        previousCustomerId: oldJob?.customerId || previous.customerId || source.customerId || null,
        jobId: ref.id, customerId,
        ...(source.kind === "job" && oldJob ? { previousJob: {
          title: oldJob.title || "", jobAddress: oldJob.jobAddress || "", notes: oldJob.notes || "",
          customerId: oldJob.customerId || null, siteContact: oldJob.siteContact || null, payer: oldJob.payer || null,
          estimate: oldJob.estimate ?? null, approvedPrice: oldJob.approvedPrice ?? null,
        } } : {}),
      });
    }
    return ref.id;
  });
}
