import { pacificDay, recordDate } from "./adminDates";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function pacificInput(value) {
  const date = recordDate(value);
  return date ? `${pacificDay(date)}T${clock.format(date)}` : "";
}

export function pacificMillis(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value || "")) return null;
  const utc = Date.parse(value + "Z");
  const matches = [7, 8].map(offset => utc + offset * 3600000).filter(ms => pacificInput(ms) === value);
  // A repeated or skipped wall-clock time requires an unambiguous selection.
  return matches.length === 1 ? matches[0] : null;
}

export function visitConflicts({ jobs, bookings, jobId, visitId, start, end, travel, legacyBookingId }) {
  const overlaps = (a, b, buffer = 0) => a - buffer < end + travel * 60000 && b + buffer > start - travel * 60000;
  const represented = new Set(jobs.flatMap(job => (job.visits || []).map(visit => visit.requestId).filter(Boolean)));
  return [
    ...jobs.flatMap(job => ["Cancelled", "Archived", "Complete"].includes(job.status) ? [] :
      (job.visits || []).filter(visit => (job.id !== jobId || visit.id !== visitId)
        && ["scheduled", "confirmed", "in_progress"].includes(visit.status)
        && visit.end && overlaps(Date.parse(visit.start), Date.parse(visit.end), Number(visit.travelMinutes || 0) * 60000))
        .map(visit => `${job.title} · ${visit.kind}`)),
    ...bookings.filter(row => ["pending", "approved"].includes(row.status) && row.id !== legacyBookingId && !represented.has(row.id)
      && overlaps(recordDate(row.requestedStart)?.getTime(), recordDate(row.requestedEnd)?.getTime()))
      .map(row => row.title || "Booking request"),
  ];
}
