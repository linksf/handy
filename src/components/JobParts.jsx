import { useState } from "react";
import { db } from "../firebase";
import { partReminder, postponeForPart, updateJobExtras } from "../utils/jobExtras";
import { displayDay, pacificDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";

const empty = { name: "", vendor: "", expectedOn: "", returnBy: "", reminderOn: "", visitId: "", status: "Ordered" };
export default function JobParts({ job, ctx }) {
  const [form, setForm] = useState(empty);
  const [target, setTarget] = useState("");
  const [hold, setHold] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const rows = job.parts || [];
  const visits = job.visits || [];
  const f = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const run = async (patch, event, message, done) => {
    setBusy(true); setError(""); setStatus("");
    try { await updateJobExtras(db, job.id, patch, event); done(); setStatus(message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <Card>
    <h2 style={{ marginTop: 0 }}>Parts and deferred work</h2>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    {rows.map(row => {
      const visit = visits.find(item => item.id === row.visitId);
      const reminder = partReminder(row, pacificDay(new Date()));
      return <section key={row.id} className="visit-row">
        <strong>{row.name} · {row.status}</strong>
        <p>{[row.vendor, row.expectedOn && `Expected ${displayDay(row.expectedOn)}`, row.returnBy && `Return by ${displayDay(row.returnBy)}`,
          row.reminderOn && `Remind ${displayDay(row.reminderOn)}`].filter(Boolean).join(" · ")}</p>
        {reminder && <p className="admin-status admin-status--decision">{reminder[1]} due</p>}
        {visit && <p>{visit.kind} · {visit.status}</p>}
        {job.status !== "Archived" && <div className="admin-action-row">
          <Btn onClick={() => { setTarget(row.id); setForm({ ...row }); }}>Edit part</Btn>
          {visit && ["scheduled", "confirmed"].includes(visit.status) && !["Received","Returned"].includes(row.status) &&
            <Btn onClick={() => { setHold(row.id); setReason(`Waiting for ${row.name}`); }}>Postpone visit</Btn>}
          {visit?.status === "deferred" && <Btn onClick={() => ctx.nav("visitEditor", [job.id, visit.id])}>Reschedule visit</Btn>}
        </div>}
        {hold === row.id && <div className="billing-review">
          <p>Put {visit?.kind} on hold and remove it from Upcoming. Its previous time stays in history.
            {visit?.calendarEventId && " Sync the visit from the job to mark the calendar event postponed and free the old slot."}</p>
          <Input label="Postponement reason" value={reason} onChange={setReason} />
          <div className="admin-action-row">
            <Btn disabled={busy || !reason.trim()} onClick={() => run(current => postponeForPart(current, row.id, row.visitId, reason.trim()),
              "visit postponed for part", "Visit postponed.", () => setHold(""))}>Confirm postponement</Btn>
            <Btn color="#67757d" onClick={() => setHold("")}>Cancel postponement</Btn>
          </div>
        </div>}
      </section>;
    })}
    {job.status !== "Archived" && <form className="visit-row" onSubmit={event => {
      event.preventDefault();
      if (!form.name.trim() || busy) return;
      const id = target || crypto.randomUUID();
      run(current => {
        const parts = current.parts || [];
        if (target && !parts.some(row => row.id === target)) throw new Error("Part no longer available.");
        if (form.visitId && !current.visits?.some(row => row.id === form.visitId)) throw new Error("Choose an existing visit.");
        const part = { ...form, id, name: form.name.trim(), vendor: form.vendor.trim() };
        return { parts: target ? parts.map(row => row.id === target ? part : row) : [...parts, part] };
      }, "part saved", "Part saved.", () => { setForm(empty); setTarget(""); });
    }}>
      <h3>{target ? "Edit part" : "Add part"}</h3>
      <Input label="Part or deferred work" value={form.name} onChange={f("name")} />
      <Input label="Vendor" value={form.vendor} onChange={f("vendor")} />
      <Select label="Part status" value={form.status} onChange={f("status")} options={["Needed", "Ordered", "Backordered", "Received", "Returned"]} />
      <Select label="Dependent visit" value={form.visitId} onChange={f("visitId")} options={[
        {value:"",label:"No visit selected"}, ...visits.map(row => ({ value: row.id, label: `${row.kind} · ${displayDay(pacificDay(row.start))}` })),
      ]} />
      <div className="admin-action-row">
        <Input label="Expected date" type="date" value={form.expectedOn} onChange={f("expectedOn")} />
        <Input label="Return deadline" type="date" value={form.returnBy} onChange={f("returnBy")} />
        <Input label="Remind on" type="date" value={form.reminderOn} onChange={f("reminderOn")} />
      </div>
      <Btn type="submit" disabled={busy || !form.name.trim()}>Save part</Btn>
    </form>}
  </Card>;
}
