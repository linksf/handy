import LaborEntriesEditor, { validLaborEntries } from "./LaborEntriesEditor";
import { hourlyLaborTotal } from "@handy/shared/finance";
import { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import JobStatusSelect from "./ui/JobStatusSelect";
import { STATUSES } from "../constants";
import { useMobile } from "../hooks/useMobile";
import { useAdminLocalState } from "../hooks/useAdminLocalState";
import { changeWorkSession, roundBillable } from "../utils/workSessionStore";
import { pacificInput, pacificMillis } from "../utils/visitTime";
import { db } from "../firebase";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

export default function JobDetailsTab({ job, saveJob, ctx, costBreakdown, profit, openEditor = false }) {
  const isMobile = useMobile();
  const cost = costBreakdown.total;
  const { data, jobRevenue, updateJob } = ctx;
  const [draft, setDraft] = useAdminLocalState(`job-edit:${job.id}`, null);
  const [editing, setEditing] = useState(openEditor || !!draft);
  const [form, setForm] = useState(() => ({ ...job, ...draft }));
  const [formSaving, setFormSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState("");
  const f = key => value => {
    setForm(previous => ({ ...previous, [key]: value }));
    setDraft(previous => ({ ...previous, [key]: value }));
  };
  const saveDetails = async () => {
    setFormSaving(true);
    setFormError("");
    try {
      await saveJob(draft || {});
      setDraft(null);
      setEditing(false);
      setFormMessage("Job details saved.");
    } catch (error) { setFormError(error.message || "Could not save. Your edits are still here."); }
    finally { setFormSaving(false); }
  };

  const revenue = jobRevenue(job);
  const flatRate = parseFloat(job.price) || 0;
  const hourlyTotal = hourlyLaborTotal(job);

  const [timerLoaded, setTimerLoaded] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [manualHours, setManualHours] = useState("");
  const [addingManualHours, setAddingManualHours] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editHours, setEditHours] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [reason, setReason] = useState("");
  const [stopPreview, setStopPreview] = useState(null);
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");

  const workSessionsPath = useMemo(() => collection(db, "jobs", job.id, "workSessions"), [job.id]);

  useEffect(() => {
    const activeQ = query(workSessionsPath, where("endMs", "==", null), limit(1));
    const unsubActive = onSnapshot(activeQ, (snap) => {
      const docSnap = snap.docs[0];
      setTimerLoaded(true);
      setActiveSession(docSnap ? { id: docSnap.id, ...docSnap.data() } : null);
    });

    const recentQ = query(workSessionsPath, orderBy("startMs", "desc"), limit(20));
    const unsubRecent = onSnapshot(recentQ, (snap) => {
      setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubActive();
      unsubRecent();
    };
  }, [workSessionsPath]);

  const formatMs = ms => ms != null ? `${pacificInput(ms).replace("T", " ")} Pacific` : "";
  const duration = (start, end) => end > start && start != null ? (end - start) / 60000 : 0;
  const totals = (startMs, endMs, billableMinutes = roundBillable(duration(startMs, endMs))) => ({
    startMs, endMs, durationMinutes: duration(startMs, endMs), billableMinutes, billableHours: billableMinutes / 60,
  });
  const runSession = async (action, onSuccess = () => {}) => {
    setSessionError("");
    setSessionMessage("");
    setSavingSession(true);
    try { await action(); onSuccess(); setSessionMessage("Time saved."); }
    catch (error) { setSessionError(error.message || "Could not save time."); }
    finally { setSavingSession(false); }
  };
  const beginEditSession = session => {
    setEditingSessionId(session.id);
    setEditStart(session.manual && !session.hasActual ? "" : pacificInput(session.startMs));
    setEditEnd(session.manual && !session.hasActual ? "" : pacificInput(session.endMs));
    setEditHours(session.manual ? String(Number(session.billableHours) || 0) : "");
    setReason("");
  };
  const editStartMs = pacificMillis(editStart);
  const editEndMs = pacificMillis(editEnd);
  const proposed = totals(editStartMs, editEndMs, editHours === "" ? undefined : Number(editHours) * 60);
  const manualStartMs = pacificMillis(manualStart);
  const manualEndMs = pacificMillis(manualEnd);
  const manualDuration = duration(manualStartMs, manualEndMs);
  const startWork = () => runSession(() => changeWorkSession(db, job.id, crypto.randomUUID(),
    () => totals(Date.now(), null)));
  const saveSessionEdit = session => runSession(() => {
    const billableOnly = session.manual && !session.hasActual && !editStart && !editEnd;
    if (!billableOnly && (editStartMs === null || (editEnd && (editEndMs === null || editEndMs <= editStartMs)))) {
      throw new Error("Enter valid Pacific start and end times.");
    }
    if (!editEnd && activeSession && activeSession.id !== session.id) throw new Error("Stop the running timer before reopening this session.");
    if (editHours !== "" && (!Number.isFinite(Number(editHours)) || Number(editHours) < 0)) throw new Error("Enter valid billable hours.");
    return changeWorkSession(db, job.id, session.id, before => {
      if (!before || before.startMs !== session.startMs || before.endMs !== session.endMs || before.billableHours !== session.billableHours) {
        throw new Error("This session changed. Reopen it and try again.");
      }
      return billableOnly ? { ...before, billableHours: Number(editHours), billableMinutes: Number(editHours) * 60 }
        : { ...before, ...proposed, hasActual: true };
    }, reason.trim());
  }, () => setEditingSessionId(null));
  const saveStop = () => runSession(() => changeWorkSession(db, job.id, stopPreview.id, before => {
    if (!before || before.endMs != null) throw new Error("This timer has already stopped.");
    return { ...before, ...totals(before.startMs, stopPreview.endMs), hasActual: true };
  }), () => setStopPreview(null));
  const addManual = () => runSession(() => {
    const hasActual = !!(manualStart || manualEnd);
    if (hasActual && !manualDuration) throw new Error("Enter a valid Pacific start and end.");
    const billed = manualHours === "" ? roundBillable(manualDuration) : Number(manualHours) * 60;
    if (!Number.isFinite(billed) || billed < 0 || (!hasActual && !billed)) throw new Error("Enter actual time or billable hours.");
    const now = Date.now();
    return changeWorkSession(db, job.id, crypto.randomUUID(), () => ({
      ...totals(hasActual ? manualStartMs : now, hasActual ? manualEndMs : now, billed), manual: true, hasActual,
    }), "Manual entry");
  }, () => { setManualHours(""); setManualStart(""); setManualEnd(""); });

  return (
    <div>
      {!openEditor && <div id="job-timer"><Card>
        <h3 style={{ marginTop: 0 }}>Work timer</h3>
        <p>{activeSession ? `Running since ${formatMs(activeSession.startMs)}` : "No active timer."}</p>
        {sessionError && <p role="alert">{sessionError}</p>}
        {sessionMessage && <p role="status">{sessionMessage}</p>}
        <div className="admin-action-row">
          {activeSession ? <Btn disabled={savingSession} onClick={() => setStopPreview({
            id: activeSession.id, ...totals(activeSession.startMs, Date.now()),
          })}>Review stop</Btn> : <Btn disabled={savingSession || !timerLoaded} onClick={startWork}>Start timer</Btn>}
        </div>
        {stopPreview && <>
          <p>Actual {Math.round(stopPreview.durationMinutes)} min · Billable {stopPreview.billableMinutes} min (rounded down to 30-minute blocks)</p>
          <div className="admin-action-row"><Btn disabled={savingSession} onClick={saveStop}>Save stop</Btn>
            <Btn onClick={() => setStopPreview(null)}>Keep running</Btn></div>
        </>}
        <details><summary>Add manual session</summary>
          <Input label="Manual start (Pacific)" type="datetime-local" value={manualStart} onChange={setManualStart} />
          <Input label="Manual end (Pacific)" type="datetime-local" value={manualEnd} onChange={setManualEnd} />
          <Input label="Manual billable hours (optional)" type="number" value={manualHours} onChange={setManualHours} />
          <p>Actual {Math.round(manualDuration)} min · Billable {manualHours === "" ? roundBillable(manualDuration) : Number(manualHours) * 60} min</p>
          <Btn disabled={savingSession} onClick={addManual}>Add manual session</Btn>
        </details>
        {sessions.map(session => <section className="visit-row" key={session.id}>
          <strong>{session.manual ? "Manual entry" : session.endMs == null ? "Running session" : "Completed session"}</strong>
          <p className="queue-meta">{session.manual && !session.hasActual ? "Actual time unavailable" : `${formatMs(session.startMs)} → ${formatMs(session.endMs) || "running"} · ${Math.round(session.durationMinutes || 0)} min actual`}
            {session.endMs != null ? ` · ${Number(session.billableMinutes) || 0} min billable` : ""}</p>
          {editingSessionId === session.id ? <>
            <Input label="Correct start (Pacific)" type="datetime-local" value={editStart} onChange={setEditStart} />
            <Input label="Correct end (Pacific)" type="datetime-local" value={editEnd} onChange={setEditEnd} />
            <Input label="Billable hours override" type="number" value={editHours} onChange={setEditHours} />
            <p>Actual {Math.round(proposed.durationMinutes)} min · Billable {proposed.billableMinutes} min. The base labor invoice line uses these hours.</p>
            <Input label="Correction reason" value={reason} onChange={setReason} />
            <div className="admin-action-row"><Btn disabled={savingSession || !reason.trim()} onClick={() => saveSessionEdit(session)}>Save correction</Btn>
              <Btn onClick={() => setEditingSessionId(null)}>Cancel</Btn></div>
          </> : <Btn small onClick={() => beginEditSession(session)}>Correct time</Btn>}
        </section>)}
      </Card></div>}
      {formMessage && <p role="status">{formMessage}</p>}
      {formError && <p role="alert">{formError}</p>}
      {editing ? (
        <Card>
          <Input label="Title" value={form.title} onChange={f("title")} />
          <details><summary>Service address, contacts and pricing</summary>
            <Input label="Service address" value={form.jobAddress || ""} onChange={f("jobAddress")} />
            {[["siteContact", "Site contact"], ["payer", "Payer"]].flatMap(([key, label]) =>
              ["name", "phone", "email"].map(field => <Input key={`${key}-${field}`} label={`${label} ${field}`}
                value={form[key]?.[field] || ""} onChange={value => f(key)({ ...form[key], [field]: value })} />))}
            <Input label="Estimate ($)" type="number" value={form.estimate ?? ""} onChange={f("estimate")} />
            <Input label="Approved price ($)" type="number" value={form.approvedPrice ?? ""} onChange={f("approvedPrice")} />
          </details>
          <Select label="Customer" value={form.customerId} onChange={f("customerId")} options={data.customers.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Date" value={form.date} onChange={f("date")} type="date" />
          <Select label="Status" value={form.status} onChange={f("status")} options={STATUSES} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Input label="Flat Rate ($)" value={form.price || ""} onChange={f("price")} type="number" placeholder="0.00" />
            <div /> {/* spacer */}
            <Input label="Hourly Rate ($/hr)" value={form.hourlyRate || ""} onChange={f("hourlyRate")} type="number" placeholder="0.00" />
            <Input label="Hours" value={form.hours || ""} onChange={f("hours")} type="number" placeholder="0" />
          </div>
          <LaborEntriesEditor entries={form.laborEntries} onChange={f("laborEntries")} />
          {(hourlyLaborTotal(form) > 0 || (parseFloat(form.price) || 0) > 0) && (
            <div style={{ fontSize: 13, color: "#7f8c8d", marginBottom: 12, marginTop: -4 }}>
              Total revenue: <strong>${(
                (parseFloat(form.price) || 0) +
                hourlyLaborTotal(form)
              ).toFixed(2)}</strong>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Notes</div>
            <textarea
              value={form.notes || ""}
              onChange={e => f("notes")(e.target.value)}
              rows={3}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Photos (URLs, one per line)</div>
            <textarea
              value={(form.photos || []).join("\n")}
              onChange={e => f("photos")(e.target.value.split("\n").filter(Boolean))}
              rows={2}
              placeholder="https://..."
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn disabled={formSaving || !validLaborEntries(form.laborEntries)} onClick={saveDetails}>{formSaving ? "Saving…" : "Save"}</Btn>
            <Btn disabled={formSaving} color="#7f8c8d" onClick={() => { setDraft(null); setForm(job); setEditing(false); setFormError(""); }}>Discard edits</Btn>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 700 }}>Job Details</span>
            <Btn small onClick={() => { setForm({ ...job, ...draft }); setEditing(true); }}>Edit</Btn>
          </div>
          {job.date && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Date:</span>{" "}
              <span style={{ fontSize: 13 }}>{job.date}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Status:</span>
            <JobStatusSelect job={job} updateJob={updateJob} />
          </div>
          {/* Revenue breakdown */}
          {flatRate > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Flat Rate:</span>{" "}
              <span style={{ fontSize: 13 }}>${flatRate.toFixed(2)}</span>
            </div>
          )}
          {hourlyTotal > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Hourly:</span>{" "}
              <span style={{ fontSize: 13 }}>${hourlyTotal.toFixed(2)} across all labor rates</span>
            </div>
          )}

          {(job.laborEntries || []).map((entry, index) => <div key={index} style={{ fontSize: 13, marginBottom: 6 }}>
            <strong>{entry.name}:</strong> {entry.hours} hrs × ${Number(entry.hourlyRate).toFixed(2)}/hr
          </div>)}
          {job.notes && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Notes:</span>{" "}
              <span style={{ fontSize: 13 }}>{job.notes}</span>
            </div>
          )}
          {job.photos?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Photos:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {job.photos.map((p, i) => (
                  <a key={i} href={p} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2980b9" }}>Photo {i + 1}</a>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Revenue", `$${revenue.toFixed(2)}`, "#d6eaf8", "#2980b9"],
          ["Cost", `$${cost.toFixed(2)}`, "#fadbd8", "#c0392b"],
          ["Profit", `$${profit.toFixed(2)}`, profit >= 0 ? "#d5f5e3" : "#fadbd8", profit >= 0 ? "#27ae60" : "#c0392b"],
        ].map(([l, v, bg, tc]) => (
          <Card key={l} style={{ background: bg, textAlign: "center", padding: 14 }}>
            <div style={{ fontSize: 12, color: tc, fontWeight: 600 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tc }}>{v}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
