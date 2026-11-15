import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { photoData } from "../utils/captureMedia";
import { centsInput, saveReceipt } from "../utils/captureStore";
import { pacificDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";

const blank = jobId => ({ jobId, amount: "", description: "", reimbursable: false });
const initial = { merchant: "", date: "", total: "" };
export default function ReceiptCapture({ job, jobs }) {
  const [form, setForm] = useState(initial);
  const [lines, setLines] = useState(() => [blank(job.id)]);
  const [photo, setPhoto] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const id = useRef(null);
  const input = useRef(null);
  const [review, setReview] = useState(false);
  const f = field => value => { setForm(previous => ({ ...previous, [field]: value })); setReview(false); };
  const change = (index, field, value) => {
    setLines(previous => previous.map((line, i) => i === index ? { ...line, [field]: value } : line));
    setReview(false);
  };
  const extract = async image => {
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await httpsCallable(functions, "draftAdminCapture")({ kind: "receipt",
        mimeType: "image/jpeg", data: image.split(",")[1] });
      setSuggestion(data);
      setForm(previous => ({ ...previous, ...Object.fromEntries(Object.keys(initial).filter(key => data[key]).map(key => [key, data[key]])) }));
      setReview(false);
    } catch (err) { setError(err.message || "Extraction unavailable. Enter receipt details below."); }
    finally { setBusy(false); }
  };
  const allocated = lines.reduce((sum, line) => sum + (centsInput(line.amount) || 0), 0);
  return <Card>
    <h2 style={{ marginTop: 0 }}>Receipt</h2>
    <label className="intake-field">Receipt photo<input ref={input} type="file" accept="image/*" onChange={async event => {
      setError(""); setSuggestion(null); setReview(false);
      try { setPhoto(event.target.files[0] ? await photoData(event.target.files[0]) : ""); }
      catch (err) { setPhoto(""); setError(err.message); }
    }} /></label>
    {photo && <img className="change-photo" src={photo} alt="Receipt to review" />}
    <div className="admin-action-row">
      <Btn disabled={!photo || busy || !navigator.onLine} onClick={() => extract(photo)}>Extract receipt details</Btn>
      {import.meta.env.HANDY_SYNTHETIC_PREVIEW && <Btn disabled={busy} onClick={() => extract("data:image/jpeg;base64,fixture")}>Use sample receipt</Btn>}
    </div>
    {suggestion?.review && <p className="queue-meta">{suggestion.review}</p>}
    <Input label="Merchant" value={form.merchant} onChange={f("merchant")} />
    <Input label="Receipt date" type="date" value={form.date} onChange={f("date")} />
    <Input label="Receipt total ($)" type="number" value={form.total} onChange={f("total")} />
    {lines.map((line, index) => <fieldset key={index} className="receipt-allocation">
      <legend>Allocation {index + 1}</legend>
      <Select label={`Job for allocation ${index + 1}`} value={line.jobId} onChange={value => change(index, "jobId", value)}
        options={[{ value: "", label: "Choose a job" }, ...jobs.map(row => ({ value: row.id, label: row.title }))]} />
      <Input label={`Amount for allocation ${index + 1}`} type="number" value={line.amount} onChange={value => change(index, "amount", value)} />
      <Input label={`Description for allocation ${index + 1}`} value={line.description} onChange={value => change(index, "description", value)} />
      <label><input type="checkbox" checked={line.reimbursable} onChange={event => change(index, "reimbursable", event.target.checked)} /> Reimbursable allocation {index + 1}</label>
      {lines.length > 1 && <button type="button" className="admin-quiet" onClick={() => {
        setLines(current => current.filter((_, i) => i !== index)); setReview(false);
      }}>Remove allocation {index + 1}</button>}
    </fieldset>)}
    <p role="status">Allocated ${(allocated / 100).toFixed(2)}{Number.isFinite(centsInput(form.total)) && ` · Remaining ${((centsInput(form.total) - allocated) / 100).toFixed(2)}`}</p>
    {review && <p className="billing-review">Review the allocations. Saving adds dated expenses to the selected jobs.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="admin-action-row">
      <Btn disabled={busy || lines.length >= 12} onClick={() => { setLines(current => [...current, blank("")]); setReview(false); }}>Add split</Btn>
      {!review ? <Btn disabled={busy} onClick={() => { setReview(true); setError(""); }}>Review split</Btn> :
        <Btn disabled={busy || !navigator.onLine} onClick={async () => {
          setBusy(true); setError(""); setMessage("");
          id.current ??= crypto.randomUUID();
          try {
            await saveReceipt(db, { ...form, date: pacificDay(form.date), id: id.current, lines, photo, proposed: suggestion });
            id.current = null; setForm(initial); setLines([blank(job.id)]); setPhoto(""); setSuggestion(null);
            setReview(false); input.current.value = ""; setMessage("Receipt and allocations saved.");
          } catch (err) { setError(err.message); }
          finally { setBusy(false); }
        }}>Save receipt split</Btn>}
    </div>
  </Card>;
}
