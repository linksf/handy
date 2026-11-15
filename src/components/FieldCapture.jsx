import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { drainCaptures, putCapture, readCaptures, removeCapture, watchCaptures } from "../utils/captureQueue";
import { photoData } from "../utils/captureMedia";
import { pacificMillis } from "../utils/visitTime";
import { roundBillable } from "../utils/workSessionStore";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Card from "./ui/Card";
import VoiceDraft from "./VoiceDraft";
import ReceiptCapture from "./ReceiptCapture";

export default function FieldCapture({ job, ctx }) {
  const owner = ctx.captureOwner;
  const [note, setNote] = useState(job.notes || "");
  const [base, setBase] = useState(job.notes || "");
  const [photo, setPhoto] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [entries, setEntries] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoId, setPhotoId] = useState("");
  const [viewedPhoto, setViewedPhoto] = useState("");
  const startMs = pacificMillis(start);
  const endMs = pacificMillis(end);
  const actual = startMs !== null && endMs > startMs ? (endMs - startMs) / 60000 : 0;
  const billable = roundBillable(actual);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      setOnline(navigator.onLine);
      readCaptures(owner).then(rows => {
        if (live) setEntries(rows.filter(row => row.jobId === job.id));
      }).catch(() => { if (live) setError("Local capture storage is unavailable."); });
    };
    const stop = watchCaptures(refresh);
    refresh();
    return () => { live = false; stop(); };
  }, [owner, job.id]);
  const run = async action => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (err) { setError(err.message || "Capture could not be saved."); }
    finally { setBusy(false); }
  };
  const queue = (kind, fields, after) => run(async () => {
    if (!owner) throw new Error("Sign in as owner to capture work.");
    await putCapture({ ...fields, id: crypto.randomUUID(), owner, jobId: job.id, kind, createdAt: Date.now(), state: "queued" });
    after?.();
    void drainCaptures(owner).catch(() => setError("Could not refresh capture sync."));
  });
  const conflict = (entry, resolution) => run(async () => {
    if (resolution === "remote") {
      await removeCapture(entry.id);
      setNote(entry.current);
      setBase(entry.current);
      return;
    }
    await putCapture({ ...entry, resolution, base: entry.current, state: "queued" });
    await drainCaptures(owner);
  });
  return <div className="intake-detail">
    <Card>
      <h2 style={{ marginTop: 0 }}>Field capture</h2>
      <p role="status">{online ? "Online" : "Offline"} · {entries.filter(row => row.state !== "synced").length} waiting for sync or review</p>
      {error && <p role="alert">{error}</p>}
      <label className="intake-field" htmlFor="field-note">Job note</label><textarea id="field-note" rows={4} value={note} onChange={event => setNote(event.target.value)} />
      <div className="admin-action-row">
        <Btn disabled={busy || note === base} onClick={() => queue("note", { text: note, base }, () => setBase(note))}>Save note to queue</Btn>
        <Btn disabled={busy} color="#67757d" onClick={() => { setBase(job.notes || ""); setNote(job.notes || ""); }}>Load saved note</Btn>
      </div>
      <VoiceDraft online={online} apply={draft => setNote(previous => [previous.trim(), draft].filter(Boolean).join("\n\n"))} />
      <details>
        <summary>Capture photo</summary>
        <label className="intake-field">Field photo<input type="file" accept="image/*" onChange={event => {
          const file = event.target.files[0];
          setPhoto("");
          if (file) run(async () => setPhoto(await photoData(file)));
        }} /></label>
        {photo && <img className="change-photo" src={photo} alt="Field photo preview" />}
        <Btn disabled={!photo || busy} onClick={() => queue("photo", { photo }, () => setPhoto(""))}>Save photo to queue</Btn>
      </details>
      <details>
        <summary>Capture time</summary>
        <Input label="Capture start (Pacific)" type="datetime-local" value={start} onChange={setStart} />
        <Input label="Capture end (Pacific)" type="datetime-local" value={end} onChange={setEnd} />
        <p>{actual} min actual · {billable} min billable</p>
        <Btn disabled={!actual || busy} onClick={() => queue("time", { session: {
          startMs, endMs, durationMinutes: actual, billableMinutes: billable, billableHours: billable / 60,
          manual: true, hasActual: true,
        } }, () => { setStart(""); setEnd(""); })}>Save time to queue</Btn>
      </details>
      <div className="visit-row">
        <h3>Capture sync</h3>
        <Btn disabled={!online || busy || !entries.some(row => ["queued", "failed"].includes(row.state))} onClick={() => run(() => drainCaptures(owner))}>Retry queued captures</Btn>
        {entries.map(entry => <section key={entry.id} className="visit-row">
          <p>{entry.kind} · {entry.state === "conflict" ? "Conflict needs review" : entry.state}{entry.error ? ` · ${entry.error}` : ""}</p>
          {entry.state === "conflict" && <>
            <strong>Saved elsewhere</strong><p className="intake-message">{entry.current || "(empty)"}</p>
            <strong>Your queued note</strong><p className="intake-message">{entry.text || "(empty)"}</p>
            <div className="admin-action-row">
              <Btn disabled={busy || !online} onClick={() => conflict(entry, "replace")}>Use queued note</Btn>
              <Btn disabled={busy || !online} onClick={() => conflict(entry, "append")}>Append queued note</Btn>
              <Btn disabled={busy} onClick={() => conflict(entry, "remote")}>Keep saved note</Btn>
            </div>
          </>}
        </section>)}
      </div>
      {!!job.fieldPhotoIds?.length && <details>
        <summary>Synced field photos ({job.fieldPhotoIds.length})</summary>
        <div className="admin-action-row">{job.fieldPhotoIds.map((id, index) =>
          <Btn key={id} disabled={busy || !online} onClick={() => run(async () => {
            setPhotoId(id); setViewedPhoto("");
            const snapshot = await getDoc(doc(db, "jobs", job.id, "privateRecords", id));
            const data = snapshot.data()?.data;
            if (typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) throw new Error("Photo unavailable.");
            setViewedPhoto(data);
          })}>Open field photo {index + 1}</Btn>)}</div>
        {photoId && viewedPhoto && <img className="change-photo" src={viewedPhoto} alt="Synced field photo" />}
      </details>}
    </Card>
    <ReceiptCapture job={job} jobs={ctx.data.jobs} />
  </div>;
}
