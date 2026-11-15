import { useState } from "react";
import { closeoutFor } from "../utils/closeout";
import { pacificDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Card from "./ui/Card";
import Input from "./ui/Input";

const usd = amount => `$${Math.max(0, amount).toFixed(2)}`;
export default function JobCloseout({ job, saveJob, ctx }) {
  const state = closeoutFor(job);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => pacificDay(new Date()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const archived = job.status === "Archived";
  const run = async (patch, text) => {
    setBusy(true); setError(""); setMessage("");
    try { await saveJob(patch); setMessage(text); }
    catch (err) { setError(err.message || "Could not save closeout."); }
    finally { setBusy(false); }
  };
  return <Card>
    <h2 style={{ marginTop: 0 }}>Closeout</h2>
    <ul className="queue-rows">
      <li className="queue-row"><span>Job completion · {state.complete ? "Complete" : job.status}</span>
        {!archived && !state.complete && <Btn disabled={busy} onClick={() => run({ status: "Complete" }, "Job marked complete.")}>Mark job complete</Btn>}</li>
      <li className="queue-row"><div>
        <strong>Final visit</strong>
        <p>{job.finalVisit ? `${job.finalVisit.outcome} · ${job.finalVisit.date}` :
          job.visits?.some(visit => visit.status === "completed") ? "A completed visit is on record." : "Outcome pending"}</p>
        <p>{state.openVisits.length} open visit{state.openVisits.length === 1 ? "" : "s"}</p>
        {!archived && <Input label="Final visit date" type="date" value={date} onChange={setDate} />}
      </div>{!archived && <div className="admin-action-row">
        <Btn disabled={busy || !date || !!state.openVisits.length} onClick={() =>
          run({ finalVisit: { outcome: "Completed", date } }, "Final visit recorded.")}>Record final visit</Btn>
        <Btn disabled={busy || !date || !!state.openVisits.length} onClick={() =>
          run({ finalVisit: { outcome: "No visit required", date } }, "Visit outcome recorded.")}>No visit required</Btn>
      </div>}</li>
      {state.invoices.map(invoice => <li key={invoice.id} className="queue-row">
        <div><strong>{invoice.name}</strong><p>{invoice.issued ? "Issued" : "Issue pending"} · {usd(invoice.total - invoice.paid)} balance</p></div>
        <Btn onClick={() => ctx.nav("jobInvoice", [job.id, invoice.id])}>Open invoice</Btn>
      </li>)}
      {!state.invoices.length && <li className="queue-row">Invoice · No billable lines or payments</li>}
      <li className="queue-row"><span>Cost dates · {state.expenses.length || state.invoiceExpenses.length || state.materials ? "Needs review" : "Recorded"}</span>
        <div className="admin-action-row">
          {!!state.expenses.length && <Btn onClick={() => ctx.nav("jobSection", [job.id, "expenses"])}>Review expenses</Btn>}
          {state.materials && <Btn onClick={() => ctx.nav("jobSection", [job.id, "tasks"])}>Review materials</Btn>}
          {!!state.invoiceExpenses.length && <Btn onClick={() => ctx.nav("jobInvoice", [job.id, "primary"])}>Review invoice costs</Btn>}
        </div></li>
    </ul>
    {job.closeout && <p role="status">Closed {job.closeout.date}{job.closeout.reason ? ` · Exception: ${job.closeout.reason}` : ""}</p>}
    {state.issues.length > 0 && <p>Open items: {state.issues.join(" · ")}</p>}
    {!archived && !!state.issues.length && <Input label="Closeout exception reason" value={reason} onChange={setReason} />}
    {!archived && <div className="admin-action-row">
      <Btn disabled={busy || !!state.openVisits.length || (state.issues.length > 0 && !reason.trim())} onClick={() => run({
        closeout: { date: pacificDay(new Date()), reason: state.issues.length ? reason.trim() : "", issues: state.issues },
      }, "Closeout saved.")}>{state.issues.length ? "Close with reason" : "Close out job"}</Btn>
      {job.closeout && <Btn disabled={busy} onClick={() => run({ closeout: null }, "Closeout reopened.")}>Reopen closeout</Btn>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
