import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { changeVisit } from "../utils/visitStore";
import { displayDay, displayPacificTime, pacificDay } from "../utils/adminDates";
import Card from "./ui/Card";
import Btn from "./ui/Btn";

export default function JobVisits({ job, ctx }) {
  const [cancelId, setCancelId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = async (id, action, success) => {
    setBusy(id);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (err) { setError(err.message || "Action failed. Try again."); }
    finally { setBusy(""); }
  };
  const visits = job.visits || [];
  const next = [...visits].sort((a, b) => String(a.start).localeCompare(String(b.start))).find(visit =>
    ["scheduled", "confirmed"].includes(visit.status) && pacificDay(visit.start) >= pacificDay(new Date()));
  const edit = id => ctx.nav("visitEditor", [job.id, id]);
  return <Card>
    <h2 style={{ marginTop: 0 }}>Visits</h2>
    <div className="admin-action-row">
      {next ? <Btn onClick={() => edit(next.id)}>Edit next visit</Btn> :
        !visits.length && job.date && ["Scheduled", "In Progress"].includes(job.status) ? <Btn onClick={() => edit("legacy")}>Edit scheduled date</Btn> : null}
      <Btn onClick={() => edit("new")}>Schedule visit</Btn>
    </div>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!visits.length && job.date && <p>Job date {displayDay(job.date)}</p>}
    {visits.map(visit => <section className="visit-row" key={visit.id}>
      <strong>{visit.kind}</strong>
      <p>{displayDay(pacificDay(visit.start))} · {displayPacificTime(visit.start)} · {visit.durationMinutes || "—"} min</p>
      <p className="queue-meta">Visit {visit.status} · Calendar {visit.syncStatus || (visit.calendarEventId ? "synced" : "untracked")}
        {visit.communicatedAt ? " · Time marked communicated" : " · Communication not recorded"}</p>
      {visit.syncError && <p role="alert">{visit.syncError}</p>}
      <div className="admin-action-row">
        <Btn onClick={() => edit(visit.id)} disabled={!!busy || !["scheduled","confirmed","deferred"].includes(visit.status)}>{visit.status === "deferred" ? "Reschedule" : "Edit"} {visit.kind}</Btn>
        {["deferred","cancelled"].includes(visit.status) && visit.calendarEventId && <p className="queue-meta">{visit.syncStatus === "synced"
          ? "The previous time is free on the calendar." : "Sync to free the previous calendar time."}</p>}
        {visit.revision && (visit.status === "scheduled" || ["deferred","cancelled"].includes(visit.status) && visit.calendarEventId) && visit.syncStatus !== "synced" && <Btn disabled={!!busy} onClick={() => run(visit.id, async () => {
          const result = await httpsCallable(functions, "syncAdminVisit")({ jobId: job.id, visitId: visit.id, revision: visit.revision });
          if (result.data.syncStatus !== "synced") throw new Error(result.data.syncError);
        }, "Calendar synced.")}>{busy === visit.id ? "Working…" : "Retry calendar sync"}</Btn>}
        {job.status !== "Archived" && ["scheduled","confirmed","in_progress"].includes(visit.status) &&
          <Btn disabled={!!busy} onClick={() => run(visit.id,
            () => changeVisit(db, job.id, visit.id, before => ({ ...before, status: "completed" }), visit.revision || ""),
            "Visit marked complete.")}>Mark visit complete</Btn>}
        {job.status !== "Archived" && ["scheduled","confirmed","deferred"].includes(visit.status) &&
          <button type="button" className="admin-quiet" disabled={!!busy} onClick={() => { setCancelId(visit.id); setCancelReason(""); }}>Cancel {visit.kind}</button>}
        {!visit.communicatedAt && ["scheduled","confirmed"].includes(visit.status) && <Btn disabled={!!busy} onClick={() => run(visit.id,
          () => changeVisit(db, job.id, visit.id, before => ({ ...before, communicatedAt: new Date().toISOString() }), visit.revision || ""),
          "Time marked communicated.")}>Mark communicated</Btn>}
      </div>
      {cancelId === visit.id && <form className="billing-review" onSubmit={event => {
        event.preventDefault();
        if (!cancelReason.trim()) return;
        run(visit.id, async () => {
          await changeVisit(db, job.id, visit.id, before => ({
            ...before, status: "cancelled", cancellationReason: cancelReason.trim(),
            revision: crypto.randomUUID(), communicatedAt: null, syncStatus: before.calendarEventId ? "pending" : "untracked", syncError: null,
          }), visit.revision || "");
          setCancelId("");
        }, "Visit cancelled in Handy.");
      }}>
        <label className="intake-field">Cancellation reason<input value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label>
        <p>The visit remains in history. Sync frees its calendar slot. Record any refund separately on the invoice.</p>
        <div className="admin-action-row"><Btn type="submit" disabled={!!busy || !cancelReason.trim()}>Confirm visit cancellation</Btn>
          <Btn color="#67757d" onClick={() => setCancelId("")}>Keep visit</Btn></div>
      </form>}
    </section>)}
  </Card>;
}
