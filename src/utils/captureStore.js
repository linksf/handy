import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { pacificDay } from "./adminDates";
import { changeWorkSession } from "./workSessionStore";

export const centsInput = value => /^\d+(\.\d{1,2})?$/.test(String(value))
  ? Math.round(Number(value) * 100) : NaN;
export function validateReceipt(receipt) {
  const total = centsInput(receipt.total);
  const lines = receipt.lines.map(line => ({ ...line, amountCents: centsInput(line.amount) }));
  if (!receipt.merchant.trim() || !/^\d{4}-\d\d-\d\d$/.test(receipt.date) || pacificDay(receipt.date) !== receipt.date ||
    !Number.isSafeInteger(total) || total <= 0 || !lines.length || lines.length > 12 ||
    lines.some(row => !row.jobId || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) ||
    lines.reduce((sum, row) => sum + row.amountCents, 0) !== total) {
    throw new Error("Enter a merchant and date, and split the exact receipt total across jobs.");
  }
  return { total, lines };
}
export async function saveReceipt(db, receipt) {
  const { total, lines } = validateReceipt(receipt);
  const receiptRef = doc(db, "adminReceipts", receipt.id);
  return runTransaction(db, async tx => {
    if ((await tx.get(receiptRef)).exists()) return;
    const jobs = new Map(await Promise.all([...new Set(lines.map(row => row.jobId))].map(async id => {
      const ref = doc(db, "jobs", id);
      const job = (await tx.get(ref)).data();
      if (!job || job.status === "Archived") throw new Error("Choose active jobs for the receipt.");
      return [id, { ref, expenses: job.expenses || [] }];
    })));
    const at = serverTimestamp();
    tx.set(receiptRef, { merchant: receipt.merchant.trim(), date: receipt.date, totalCents: total,
      allocations: lines, proposed: receipt.proposed || null, photo: receipt.photo || null, createdAt: at });
    for (const [id, { ref, expenses }] of jobs) {
      const added = lines.flatMap((line, index) => line.jobId === id ? [{
        id: `receipt-${receipt.id}-${index}`, receiptId: receipt.id, amount: line.amountCents / 100,
        name: line.description.trim() || receipt.merchant.trim(), datePaid: receipt.date,
        reimbursable: line.reimbursable, type: line.reimbursable ? "Materials" : "Shop supplies",
      }] : []);
      tx.update(ref, { expenses: [...expenses, ...added] });
      tx.set(doc(ref, "adminHistory", `receipt-${receipt.id}`), { type: "receipt allocation", receiptId: receipt.id, at, added });
    }
  });
}

export function resolveCaptureNote(current, entry) {
  if (entry.resolution === "append") return [current, entry.text].filter(Boolean).join("\n\n");
  if (current !== entry.base && current !== entry.text) return null;
  return entry.text;
}

export async function syncCapture(db, entry) {
  if (entry.kind === "time") {
    await changeWorkSession(db, entry.jobId, `capture-${entry.id}`, before => before ? null : entry.session, "Offline field capture");
    return { state: "synced" };
  }
  const jobRef = doc(db, "jobs", entry.jobId);
  const marker = doc(jobRef, "adminHistory", `capture-${entry.id}`);
  return runTransaction(db, async tx => {
    const job = (await tx.get(jobRef)).data();
    if ((await tx.get(marker)).exists()) return { state: "synced" };
    if (!job || job.status === "Archived") throw new Error("This job is unavailable for capture.");
    const at = serverTimestamp();
    if (entry.kind === "note") {
      const current = job.notes || "";
      const next = resolveCaptureNote(current, entry);
      if (next === null) return { state: "conflict", current };
      tx.update(jobRef, { notes: next });
      tx.set(marker, { type: "field note", previous: current, current: next, at });
    } else {
      tx.set(doc(jobRef, "privateRecords", `capture-${entry.id}`), { type: "field-photo", data: entry.photo, at });
      tx.update(jobRef, { fieldPhotoIds: [...(job.fieldPhotoIds || []), `capture-${entry.id}`] });
      tx.set(marker, { type: "field photo", photoId: `capture-${entry.id}`, at });
    }
    return { state: "synced" };
  });
}
