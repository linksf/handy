import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

export const roundBillable = duration => Math.floor(Math.max(0, duration) / 30) * 30;
export async function changeWorkSession(db, jobId, sessionId, build, reason = "") {
  const jobRef = doc(db, "jobs", jobId);
  const ref = doc(jobRef, "workSessions", sessionId);
  return runTransaction(db, async transaction => {
    const job = (await transaction.get(jobRef)).data();
    const before = (await transaction.get(ref)).data();
    if (!job || job.status === "Archived") throw new Error("Job unavailable.");
    const after = build(before);
    if (!after) return;
    if (after.endMs == null && job.activeWorkSessionId && job.activeWorkSessionId !== sessionId) {
      throw new Error("Another timer is already running.");
    }
    const delta = (Number(after.billableHours) || 0) - (Number(before?.billableHours) || 0);
    transaction.set(ref, after);
    const jobPatch = {
      ...(delta ? { hours: Math.round(((Number(job.hours) || 0) + delta) * 100) / 100 } : {}),
      ...(after.endMs == null ? { activeWorkSessionId: sessionId }
        : job.activeWorkSessionId === sessionId ? { activeWorkSessionId: null } : {}),
    };
    if (Object.keys(jobPatch).length) transaction.update(jobRef, jobPatch);
    transaction.set(doc(jobRef, "adminHistory", crypto.randomUUID()), {
      type: "work session", sessionId, at: serverTimestamp(), previous: before || null, current: after, reason,
    });
  });
}
