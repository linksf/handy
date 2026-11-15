import { expect, test, vi } from "vitest";
vi.mock("firebase/firestore", async () => import("../../scripts/admin-preview/firestore.js"));
import { doc, getDoc } from "firebase/firestore";
import { resolveCaptureNote, saveReceipt, syncCapture, validateReceipt } from "./captureStore";

test("receipt saves costs once across both jobs and rejects unmatched allocations", async () => {
  const receipt = { id: "test-receipt", merchant: "Test hardware", date: "2026-11-14", total: "72.50", lines: [
    { jobId: "gate", amount: "40", description: "Brackets", reimbursable: true },
    { jobId: "closet", amount: "32.50", description: "Shop supplies", reimbursable: false },
  ] };
  expect(() => validateReceipt({ ...receipt, total: "73" })).toThrow(/exact receipt total/);
  await saveReceipt({}, receipt);
  await saveReceipt({}, receipt);
  const gate = (await getDoc(doc({}, "jobs", "gate"))).data();
  const closet = (await getDoc(doc({}, "jobs", "closet"))).data();
  expect(gate.expenses).toEqual([expect.objectContaining({ amount: 40, receiptId: receipt.id, reimbursable: true })]);
  expect(closet.expenses).toEqual([expect.objectContaining({ amount: 32.5, receiptId: receipt.id, reimbursable: false })]);
});

test("stale note requires review and replay does not append twice", async () => {
  const entry = { id: "test-note", jobId: "gate", kind: "note", text: "Owner’s field note", base: "outdated copy" };
  const result = await syncCapture({}, entry);
  expect(result).toEqual({ state: "conflict", current: "" });
  expect(resolveCaptureNote("Other edit", { ...entry, base: "" })).toBeNull();
  expect(resolveCaptureNote("Other edit", { ...entry, resolution: "append" })).toBe("Other edit\n\nOwner’s field note");
  await syncCapture({}, { ...entry, resolution: "append" });
  await syncCapture({}, { ...entry, resolution: "append" });
  expect((await getDoc(doc({}, "jobs", "gate"))).data().notes).toBe(entry.text);
});

test("syncing a captured time entry twice increments billable hours once", async () => {
  const entry = { id: "test-time", jobId: "gate", kind: "time", session: {
    startMs: 1000, endMs: 3601000, durationMinutes: 60, billableMinutes: 60, billableHours: 1,
  } };
  await syncCapture({}, entry);
  await syncCapture({}, entry);
  expect((await getDoc(doc({}, "jobs", "gate"))).data().hours).toBe(1);
});
