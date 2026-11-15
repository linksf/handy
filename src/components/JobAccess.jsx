import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { savePrivateRecord } from "../utils/jobExtras";
import { pacificDay, displayDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";

const fields = {
  parking: "Parking", entry: "Entry instructions", contact: "Alternate contact",
  phone: "Alternate contact phone", lastMile: "Last-mile notes",
};
export default function JobAccess({ job, address }) {
  const [visit, setVisit] = useState("");
  const [open, setOpen] = useState(false);
  const visits = job.visits || [];
  const selected = visits.find(row => row.id === visit);
  return <details className="billing-review private-access" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Arrival and access · Private</summary>
    {open && <>
      <Select label="Access for" value={visit} onChange={setVisit} options={[
        { value: "", label: "Job default" }, ...visits.map(row => ({ value: row.id, label: `${row.kind} · ${displayDay(pacificDay(row.start))}` })),
      ]} />
      <AccessRecord key={visit} job={job} id={visit ? `access-${visit}` : "access-default"}
        address={selected?.address || address} />
    </>}
  </details>;
}

function AccessRecord({ job, id, address }) {
  const [record, setRecord] = useState(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => onSnapshot(doc(db, "jobs", job.id, "privateRecords", id), snapshot => {
    setRecord(snapshot.data() || {});
    setReady(true);
  }, () => setError("Could not load the private access record.")), [job.id, id]);
  const data = draft || record || {};
  const savedText = Object.entries(fields).filter(([key]) => record?.[key]).map(([key, label]) => `${label}: ${record[key]}`).join("\n");
  const copy = async () => {
    setError("");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(savedText);
      else {
        const field = document.createElement("textarea");
        field.value = savedText;
        document.body.appendChild(field);
        field.select();
        try { if (!document.execCommand("copy")) throw new Error(); }
        finally { field.remove(); }
      }
      setMessage("Private access details copied.");
    } catch { setError("Copy failed. You can select and copy the text."); }
  };
  return <>
    {address && <a href={`https://maps.apple.com/?q=${encodeURIComponent(address)}`}>Open address in Maps</a>}
    {ready && !draft && <>
      {Object.entries(fields).filter(([key]) => record[key]).map(([key, label]) =>
        <p key={key}><strong>{label}</strong> {record[key]}</p>)}
      {!savedText && <p>No access details saved for this selection.</p>}
      <div className="admin-action-row">
        {job.status !== "Archived" && <Btn onClick={() => setDraft({ ...record })}>Edit access</Btn>}
        {savedText && <Btn onClick={copy}>Copy private details</Btn>}
        {record.phone && <a href={`tel:${record.phone.replace(/[^+0-9]/g, "")}`}>Call alternate contact</a>}
      </div>
    </>}
    {draft && <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        await savePrivateRecord(db, job.id, id, { type: "access",
          ...Object.fromEntries(Object.keys(fields).map(key => [key, String(data[key] || "").trim()])) });
        setDraft(null); setMessage("Access details saved.");
      } catch (err) { setError(err.message); }
      finally { setBusy(false); }
    }}>
      {Object.entries(fields).map(([key, label]) => <Input key={key} label={label} value={data[key] || ""}
        onChange={value => setDraft(previous => ({ ...previous, [key]: value }))} />)}
      <div className="admin-action-row"><Btn type="submit" disabled={busy}>Save access</Btn>
        <Btn color="#67757d" disabled={busy} onClick={() => setDraft(null)}>Cancel</Btn></div>
    </form>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </>;
}
