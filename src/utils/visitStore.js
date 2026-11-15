import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { pacificDay, recordDate } from "./adminDates";

export async function changeVisit(db, jobId, visitId, build, expectedRevision, legacyBooking) {
  const ref = doc(db, "jobs", jobId);
  return runTransaction(db, async transaction => {
    const job = (await transaction.get(ref)).data();
    if (!job || job.status === "Archived") throw new Error("Job unavailable.");
    const before = (job.visits || []).find(visit => visit.id === visitId);
    if (expectedRevision !== undefined && (before?.revision || "") !== expectedRevision) {
      throw new Error("This visit changed while you were editing. Reopen it before saving.");
    }
    const after = build(before, job);
    if (!before && expectedRevision === undefined) throw new Error("Visit no longer exists.");
    if (before?.syncLeaseUntil > Date.now() && before.revision !== after.revision) {
      throw new Error("Calendar sync is in progress. Try again shortly.");
    }
    const legacyStart = recordDate(legacyBooking?.requestedStart);
    const legacyEnd = recordDate(legacyBooking?.requestedEnd);
    const preserveLegacy = !job.visits?.length && visitId !== "legacy" && job.date && ["Scheduled", "In Progress"].includes(job.status);
    const retained = preserveLegacy ? [{
      id: "legacy", kind: "Service", start: legacyStart?.toISOString() || job.date,
      end: legacyEnd?.toISOString() || null, durationMinutes: legacyStart && legacyEnd ? (legacyEnd - legacyStart) / 60000 : null,
      requestId: legacyBooking?.id || null, status: "scheduled", address: job.jobAddress || legacyBooking?.location || "",
    }] : (job.visits || []).filter(visit => visit.id !== visitId);
    const visits = [...retained, after]
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const next = visits.find(visit => visit.status === "scheduled" && pacificDay(visit.start) >= pacificDay(new Date()))
      || visits.find(visit => visit.status === "scheduled");
    transaction.update(ref, { visits,
      ...(next ? { date: pacificDay(next.start), status: job.status === "Draft" ? "Scheduled" : job.status } : {}),
    });
    transaction.set(doc(ref, "adminHistory", crypto.randomUUID()), {
      type: "visit", visitId, at: serverTimestamp(), previous: before || null, current: after,
    });
    return after;
  });
}
