import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { jobInvoices } from "../../shared/invoices.js";
import { pacificDay } from "./adminDates";

export async function updateJobExtras(db, jobId, build, event) {
  const ref = doc(db, "jobs", jobId);
  return runTransaction(db, async tx => {
    const job = (await tx.get(ref)).data();
    if (!job || job.status === "Archived") throw new Error("An active job is required.");
    const patch = build(job);
    tx.update(ref, patch);
    tx.set(doc(ref, "adminHistory", crypto.randomUUID()), {
      type: event, at: serverTimestamp(),
      previous: Object.fromEntries(Object.keys(patch).map(key => [key, job[key] ?? null])), current: patch,
    });
  });
}

export async function savePrivateRecord(db, jobId, id, fields) {
  const jobRef = doc(db, "jobs", jobId);
  const ref = doc(jobRef, "privateRecords", id);
  await runTransaction(db, async tx => {
    const job = (await tx.get(jobRef)).data();
    const before = (await tx.get(ref)).data();
    if (!job || job.status === "Archived") throw new Error("An active job is required.");
    tx.set(ref, { ...fields, updatedAt: serverTimestamp() });
    if (fields.type === "access") tx.set(doc(jobRef, "adminHistory", crypto.randomUUID()), {
      type: "access instructions", recordId: id, at: serverTimestamp(),
      previous: before || null, current: fields,
    });
  });
}

export function applyOrder(job, orderId, approval) {
  const orders = job.changeOrders || [];
  const order = orders.find(row => row.id === orderId);
  if (!order) throw new Error("Change order unavailable.");
  if (order.approval) throw new Error("Approval was already recorded.");
  if (!jobInvoices(job).some(invoice => invoice.id === approval.invoiceId)) throw new Error("Choose an existing invoice.");
  return {
    changeOrders: orders.map(row => row.id === orderId ? { ...row, approval } : row),
    invoiceItems: [...(job.invoiceItems || []), {
      id: `change-${orderId}`, name: `Change order · ${order.title}`, kind: "item",
      amount: order.amountCents / 100, invoiceId: approval.invoiceId, changeOrderId: orderId,
    }],
  };
}

export function postponeForPart(job, partId, visitId, reason) {
  const part = (job.parts || []).find(row => row.id === partId);
  const visit = (job.visits || []).find(row => row.id === visitId);
  if (!part || ["Received","Returned"].includes(part.status) || part.visitId !== visitId) throw new Error("Choose a visit that depends on a pending part.");
  if (!visit || !["scheduled", "confirmed"].includes(visit.status) || visit.syncLeaseUntil > Date.now()) {
    throw new Error("This visit cannot be postponed right now.");
  }
  return { visits: job.visits.map(row => row.id === visitId ? {
    ...row, status: "deferred", deferredForPart: partId, deferredReason: reason,
    revision: crypto.randomUUID(), communicatedAt: null,
    syncStatus: row.calendarEventId ? "pending" : "untracked",
    syncError: null,
  } : row) };
}

export function partReminder(part, today) {
  if (part.status === "Returned") return null;
  const dates = [
    [part.reminderOn, "Follow up"], [part.returnBy, "Return deadline"],
    ...(part.status === "Received" ? [] : [[part.expectedOn, "Expected arrival"]]),
  ].filter(([day]) => day && day <= today).sort(([a], [b]) => a.localeCompare(b));
  return dates[0] || null;
}

export async function createCallback(db, originalId, id, title, type) {
  const originalRef = doc(db, "jobs", originalId);
  const callbackRef = doc(db, "jobs", id);
  return runTransaction(db, async tx => {
    const original = (await tx.get(originalRef)).data();
    const prior = (await tx.get(callbackRef)).data();
    if (prior?.callbackOf === originalId) return;
    if (!original || prior) throw new Error("Original job unavailable.");
    const referencePhotos = (original.photos || []).filter(value => /^https?:\/\//i.test(value));
    const referenceMaterials = (original.tasks || []).flatMap(task => (task.materials || []).map(row => ({
      name: row.name || "Material", qty: row.qty || "", unit: row.unit || "", task: task.name || "",
    })));
    tx.set(callbackRef, {
      title, callbackOf: originalId, callbackType: type, customerId: original.customerId || "",
      jobAddress: original.jobAddress || "", siteContact: original.siteContact || null, payer: original.payer || null,
      referencePhotos, referenceMaterials,
      date: "", status: "Draft", price: "", hourlyRate: "", hours: "", tasks: [],
      payStatus: "Unpaid", amountPaid: 0, createdAt: serverTimestamp(),
    });
    tx.set(doc(originalRef, "adminHistory", crypto.randomUUID()), {
      type: "callback created", callbackJobId: id, callbackType: type, date: pacificDay(new Date()), at: serverTimestamp(),
    });
  });
}
