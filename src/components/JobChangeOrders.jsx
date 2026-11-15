import { photoData } from "../utils/captureMedia";
import { useEffect, useRef, useState } from "react";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { jobInvoices } from "../../shared/invoices.js";
import { applyOrder, updateJobExtras } from "../utils/jobExtras";
import { pacificDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";

const empty = { title: "", scope: "", amount: "" };
const usd = amount => `$${(amount / 100).toFixed(2)}`;
export default function JobChangeOrders({ job, ctx }) {
  const [form, setForm] = useState(empty);
  const [files, setFiles] = useState([]);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [approving, setApproving] = useState("");
  const [photo, setPhoto] = useState(null);
  const [approval, setApproval] = useState({});
  const invoices = jobInvoices(job);
  const amount = Math.round(Number(form.amount) * 100);
  const valid = form.title.trim() && form.scope.trim() && /^\d+(\.\d{1,2})?$/.test(form.amount) &&
    Number.isSafeInteger(amount) && amount >= 0 && files.length <= 3;
  const run = async (action, message) => {
    setBusy(true); setStatus(""); setError("");
    try { await action(); setStatus(message); }
    catch (err) { setError(err.message || "Could not save change order."); }
    finally { setBusy(false); }
  };
  return <Card>
    <h2 style={{ marginTop: 0 }}>Change orders</h2>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {(job.changeOrders || []).map(order => <section key={order.id} className="visit-row">
      <strong>{order.title} · {usd(order.amountCents)}</strong>
      <p className="intake-message">{order.scope}</p>
      <p>{order.approval ? `Approved by ${order.approval.approvedBy} · ${order.approval.approvedOn} · ${order.approval.method}` : "Approval pending"}</p>
      {order.approval?.evidence && <p className="intake-message">{order.approval.evidence}</p>}
      <div className="admin-action-row">
        {order.photoIds?.map((id, index) => <Btn key={id} onClick={() => setPhoto({ id, title: `${order.title} photo ${index + 1}` })}>View photo {index + 1}</Btn>)}
        {order.approval ? <Btn onClick={() => ctx.nav("jobInvoice", [job.id, order.approval.invoiceId])}>Open linked invoice</Btn>
          : job.status !== "Archived" && <Btn onClick={() => {
            setApproving(order.id);
            setApproval({ approvedBy: "", approvedOn: pacificDay(new Date()), method: "In person", evidence: "", invoiceId: invoices[0].id });
          }}>Record approval</Btn>}
      </div>
      {approving === order.id && <form onSubmit={event => {
        event.preventDefault();
        run(async () => {
          await updateJobExtras(db, job.id, current => applyOrder(current, order.id, { ...approval,
            approvedBy: approval.approvedBy.trim(), evidence: approval.evidence.trim(), recordedAt: new Date().toISOString() }), "change order approval");
          setApproving("");
        }, "Approval saved and charge added to the invoice.");
      }}>
        <Input label="Approved by" value={approval.approvedBy} onChange={value => setApproval({ ...approval, approvedBy: value })} />
        <Input label="Approval date (Pacific)" type="date" value={approval.approvedOn} onChange={value => setApproval({ ...approval, approvedOn: value })} />
        <Select label="Approval method" value={approval.method} options={["In person", "Text", "Email", "Phone", "Signed document"]}
          onChange={value => setApproval({ ...approval, method: value })} />
        <Input label="Approval evidence" value={approval.evidence} onChange={value => setApproval({ ...approval, evidence: value })} />
        <Select label="Invoice for change order" value={approval.invoiceId} options={invoices.map(row => ({ value: row.id, label: row.name }))}
          onChange={value => setApproval({ ...approval, invoiceId: value })} />
        <p>Adds {usd(order.amountCents)} to the selected invoice draft. The issued version stays available.</p>
        <div className="admin-action-row">
          <Btn type="submit" disabled={busy || !approval.approvedBy.trim() || !approval.evidence.trim() || !approval.approvedOn || approval.approvedOn > pacificDay(new Date())}>Save approval and add charge</Btn>
          <Btn color="#67757d" onClick={() => setApproving("")}>Cancel approval</Btn>
        </div>
      </form>}
    </section>)}
    {photo && <OrderPhoto key={photo.id} jobId={job.id} photo={photo} close={() => setPhoto(null)} />}
    {job.status !== "Archived" && <form className="visit-row" onSubmit={event => {
      event.preventDefault();
      if (!valid) return;
      run(async () => {
        const id = crypto.randomUUID();
        const photos = await Promise.all(files.map(photoData));
        const ref = doc(db, "jobs", job.id);
        const photoIds = photos.map((_, index) => `change-${id}-${index}`);
        await runTransaction(db, async tx => {
          const current = (await tx.get(ref)).data();
          if (!current || current.status === "Archived") throw new Error("An active job is required.");
          tx.update(ref, { changeOrders: [...(current.changeOrders || []), {
            id, title: form.title.trim(), scope: form.scope.trim(), amountCents: amount, photoIds,
            createdAt: new Date().toISOString(),
          }] });
          photos.forEach((data, index) => tx.set(doc(ref, "privateRecords", photoIds[index]), {
            type: "change-order-photo", orderId: id, data, createdAt: serverTimestamp(),
          }));
        });
        setForm(empty); setFiles([]); input.current.value = "";
      }, "Change order saved. Record approval when received.");
    }}>
      <h3>New change order</h3>
      <Input label="Change title" value={form.title} onChange={value => setForm({ ...form, title: value })} />
      <label className="intake-field">Revised scope<textarea rows={3} value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value })} /></label>
      <Input label="Additional charge ($)" type="number" value={form.amount} onChange={value => setForm({ ...form, amount: value })} />
      <label className="intake-field">Photos (up to three)<input ref={input} type="file" accept="image/*" multiple onChange={event => setFiles([...event.target.files])} /></label>
      <Btn type="submit" disabled={busy || !valid}>{busy ? "Saving…" : "Save change order"}</Btn>
    </form>}
  </Card>;
}

function OrderPhoto({ jobId, photo, close }) {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getDoc(doc(db, "jobs", jobId, "privateRecords", photo.id)).then(snapshot => {
      if (!active) return;
      const data = snapshot.data()?.data;
      if (data?.startsWith("data:image/jpeg;base64,")) setResult(data);
      else setError("Photo unavailable.");
    }).catch(() => { if (active) setError("Could not load photo."); });
    return () => { active = false; };
  }, [jobId, photo.id]);
  return <section className="billing-review">
    {result ? <img className="change-photo" src={result} alt={photo.title} /> : <p role="status">{error || "Loading photo…"}</p>}
    <Btn onClick={close}>Close photo</Btn>
  </section>;
}
