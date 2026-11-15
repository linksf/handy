import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { displayDay, displayPacificTime, pacificDay, recordDate, shiftDay } from "../utils/adminDates";
import { pacificInput, pacificMillis, visitConflicts } from "../utils/visitTime";
import { changeVisit } from "../utils/visitStore";
import Btn from "./ui/Btn";
import Card from "./ui/Card";
import Input from "./ui/Input";
import Select from "./ui/Select";

const time = value => `${displayDay(pacificDay(value))} · ${displayPacificTime(value)}`;
const minutes = { Assessment: 60, Installation: 120, "Return visit": 90, Service: 120 };

export default function VisitEditor({ ctx }) {
  const [jobId, visitId] = ctx.viewParam;
  const job = ctx.getJob(jobId);
  if (!job) return <p role="status">Loading job…</p>;
  const booking = ctx.bookingRequests.find(row => row.status === "approved" && row.linkedJobId === jobId);
  const original = job.visits?.find(visit => visit.id === visitId);
  if (visitId !== "new" && visitId !== "legacy" && !original) return <p>Visit unavailable.</p>;
  return <VisitForm ctx={ctx} job={job} visit={original} legacy={visitId === "legacy"} booking={booking} />;
}

function VisitForm({ ctx, job, visit, legacy, booking }) {
  const customer = ctx.getCustomer(job.customerId);
  const [kind, setKind] = useState(visit?.kind || "Assessment");
  const [start, setStart] = useState(visit?.start ? (/^\d{4}-\d\d-\d\d$/.test(visit.start) ? `${visit.start}T09:00` : pacificInput(visit.start))
    : legacy && booking?.requestedStart ? pacificInput(booking.requestedStart)
      : `${legacy && job.date ? job.date : shiftDay(pacificDay(new Date()), 1)}T09:00`);
  const [duration, setDuration] = useState(visit?.durationMinutes || (visit?.end && (Date.parse(visit.end) - Date.parse(visit.start)) / 60000)
    || (legacy && booking?.requestedStart && (recordDate(booking.requestedEnd) - recordDate(booking.requestedStart)) / 60000)
    || minutes[kind] || 120);
  const [travel, setTravel] = useState(visit?.travelMinutes ?? 30);
  const [allow, setAllow] = useState(!!visit?.allowOverlap);
  const [reason, setReason] = useState(visit?.overlapReason || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState("");
  const startMs = pacificMillis(start);
  const end = startMs === null ? null : startMs + Number(duration) * 60000;
  const blockingPart = visit?.status === "deferred" && (job.parts || []).find(row => row.id === visit.deferredForPart &&
    !["Received", "Returned"].includes(row.status));
  const valid = startMs !== null && Number(duration) >= 15 && Number(duration) <= 720 && travel !== "" && Number(travel) >= 0 && Number(travel) <= 180;
  const conflicts = valid ? visitConflicts({ jobs: ctx.data.jobs, bookings: ctx.bookingRequests,
    jobId: job.id, visitId: visit?.id, start: startMs, end, travel: Number(travel), legacyBookingId: (legacy || visit?.requestId) ? (visit?.requestId || booking?.id) : null }) : [];
  const sync = async next => {
    const result = await httpsCallable(functions, "syncAdminVisit")({ jobId: job.id, visitId: next.id, revision: next.revision });
    return { ...next, ...result.data };
  };
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    let next;
    try {
      const id = visit?.id || (legacy ? "legacy" : crypto.randomUUID());
      next = await changeVisit(db, job.id, id, before => {
        const instant = new Date(startMs).toISOString();
        const finish = new Date(end).toISOString();
        const changed = before?.start !== instant || before?.end !== finish;
        return { ...before, id, kind, start: instant, end: finish,
          address: before?.address || job.jobAddress || customer?.address || "", status: "scheduled",
          durationMinutes: Number(duration), travelMinutes: Number(travel),
          requestId: before?.requestId || (legacy ? booking?.id : null) || null,
          allowOverlap: allow, overlapReason: allow ? reason.trim() : "",
          communicatedAt: changed || before?.status === "deferred" ? null : before?.communicatedAt || null,
          deferredForPart: null, deferredReason: null,
          revision: crypto.randomUUID(), syncStatus: "pending", syncError: null,
        };
      }, visit?.revision || "", booking);
      setSaved(next);
      setSaved(await sync(next));
    } catch (err) {
      setError(next ? "Visit saved in Handy. Calendar sync could not be confirmed. Retry from the job." : err.message);
    } finally { setBusy(false); }
  };

  return <div className="quick-job">
    <header className="daily-heading"><h1>{visit || legacy ? "Edit visit" : "Schedule visit"}</h1>
      <p>{job.title} · Pacific time</p>
    </header>
    <Card><form onSubmit={submit}>
      <Select label="Visit type" value={kind} onChange={value => { if (duration === minutes[kind]) setDuration(minutes[value]); setKind(value); }}
        options={[...new Set([kind, ...Object.keys(minutes)])]} />
      <Input label="Start (Pacific)" type="datetime-local" value={start} onChange={setStart} />
      {start && startMs === null && <p role="alert">Choose an unambiguous Pacific time outside the daylight-saving transition.</p>}
      <div className="admin-action-row">
        <Input label="Duration (minutes)" type="number" value={duration} onChange={setDuration} />
        <Input label="Travel each way (minutes)" type="number" value={travel} onChange={setTravel} />
      </div>
      <p className="queue-meta">Suggested {minutes[kind] || 120} minutes for this visit type and 30 minutes of travel each way.</p>
      <h2>Review changes</h2>
      {visit?.start && <p>Current {time(visit.start)}</p>}
      {valid && <p>Proposed {time(startMs)} to {displayPacificTime(end)} · {travel} min travel each way</p>}
      <p>Updates this job and {visit?.calendarEventId ? "its existing calendar event" : "this visit’s calendar event"}.
        {visit?.requestId || (legacy && booking) ? " The original booking request stays in the record." : ""}</p>
      {conflicts.length ? <p role="status">Overlap with {conflicts.join(", ")}</p> : <p>No overlaps in loaded Handy commitments.</p>}
      <label className="intake-field"><span><input type="checkbox" checked={allow} onChange={event => setAllow(event.target.checked)} /> Allow intentional overlap</span></label>
      {allow && <Input label="Overlap reason" value={reason} onChange={setReason} />}
      {blockingPart && <p role="status">This visit was postponed for {blockingPart.name}. Confirm the part will arrive before the proposed date.</p>}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Visit saved · Calendar {saved.syncStatus}{saved.syncError ? ` · ${saved.syncError}` : ""}</p>}
      <div className="admin-action-row">
        {!saved && <Btn type="submit" disabled={busy || !valid || (conflicts.length > 0 && !allow) || (allow && !reason.trim())}>{busy ? "Saving…" : "Save visit"}</Btn>}
        <Btn color="#67757d" disabled={busy} onClick={() => ctx.nav("job/:id", job.id)}>{saved ? "Back to job" : "Cancel"}</Btn>
      </div>
    </form></Card>
  </div>;
}
