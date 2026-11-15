import { useRef, useState } from "react";
import { db } from "../firebase";
import { createCallback } from "../utils/jobExtras";
import Btn from "./ui/Btn";
import Card from "./ui/Card";
import Input from "./ui/Input";
import Select from "./ui/Select";

export default function JobCallbacks({ job, ctx }) {
  const [type, setType] = useState("Warranty");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const linked = [...ctx.data.jobs, ...(ctx.archivedJobs || [])].filter(row => row.callbackOf === job.id);
  const source = job.callbackOf && ctx.getJob(job.callbackOf);
  return <Card>
    <h2 style={{ marginTop: 0 }}>Callbacks</h2>
    {job.callbackOf && <>
      <p>{job.callbackType} callback</p>
      <Btn onClick={() => ctx.nav("job/:id", job.callbackOf)}>Open original job{source ? ` · ${source.title}` : ""}</Btn>
      {(job.referencePhotos?.length > 0 || job.referenceMaterials?.length > 0) && <details>
        <summary>Original work references</summary>
        {job.referencePhotos?.map((url, index) => <p key={url}><a href={url} target="_blank" rel="noreferrer">Original photo {index + 1}</a></p>)}
        {job.referenceMaterials?.map((row, index) => <p key={index}>{row.name} · {[row.qty, row.unit, row.task].filter(Boolean).join(" ")}</p>)}
      </details>}
    </>}
    {linked.map(row => <p key={row.id}><button className="admin-quiet" onClick={() => ctx.nav("job/:id", row.id)}>{row.title} · {row.callbackType} · {row.status}</button></p>)}
    <form onSubmit={async event => {
      event.preventDefault();
      setBusy(true); setError("");
      pending.current ??= crypto.randomUUID();
      try {
        await createCallback(db, job.id, pending.current, title.trim() || `${type} callback · ${job.title}`, type);
        ctx.nav("job/:id", pending.current);
      } catch (err) { setError(err.message); }
      finally { setBusy(false); }
    }}>
      <Select label="Callback type" value={type} onChange={setType} options={["Warranty", "New billable work"]} />
      <Input label="Callback title (optional)" value={title} onChange={setTitle} />
      <p>{type === "Warranty" ? "Starts as an unpriced warranty draft." : "Starts as a separate draft ready for pricing."} The original job and invoice retain their amounts.</p>
      <Btn type="submit" disabled={busy}>{busy ? "Creating…" : "Create callback"}</Btn>
      {error && <p role="alert">{error}</p>}
    </form>
  </Card>;
}
