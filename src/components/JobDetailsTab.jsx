import { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";
import JobStatusSelect from "./ui/JobStatusSelect";
import { STATUSES } from "../constants";
import { useMobile } from "../hooks/useMobile";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

export default function JobDetailsTab({ job, saveJob, ctx, costBreakdown, profit }) {
  const isMobile = useMobile();
  const cost = costBreakdown.total;
  const { data, jobRevenue, updateJob } = ctx;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(job);
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));

  const revenue = jobRevenue(job);
  const flatRate = parseFloat(job.price) || 0;
  const hourlyTotal = (parseFloat(job.hourlyRate) || 0) * (parseFloat(job.hours) || 0);

  const [activeSession, setActiveSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [manualHours, setManualHours] = useState("");
  const [addingManualHours, setAddingManualHours] = useState(false);

  const workSessionsPath = useMemo(() => collection(db, "jobs", job.id, "workSessions"), [job.id]);

  useEffect(() => {
    const activeQ = query(workSessionsPath, where("endMs", "==", null), limit(1));
    const unsubActive = onSnapshot(activeQ, (snap) => {
      const docSnap = snap.docs[0];
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

  const formatMs = (ms) => {
    if (!ms && ms !== 0) return "";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
    }
  };

  const startWork = async () => {
    if (activeSession) return;
    await addDoc(workSessionsPath, {
      startMs: Date.now(),
      endMs: null,
      billableMinutes: 0,
      billableHours: 0,
    });
  };

  const stopWork = async () => {
    if (!activeSession) return;
    const endMs = Date.now();
    const startMs = parseFloat(activeSession.startMs) || 0;

    const durationMinutes = Math.max(0, (endMs - startMs) / 60000);
    const billableChunks = Math.floor(durationMinutes / 30); // full 30-minute chunks
    const billableMinutes = billableChunks * 30;
    const billableHours = billableChunks * 0.5; // exact multiples of 0.5

    const sessionRef = doc(db, "jobs", job.id, "workSessions", activeSession.id);
    await updateDoc(sessionRef, {
      endMs,
      durationMinutes,
      billableMinutes,
      billableHours,
    });

    if (billableHours > 0) {
      const currentHours = parseFloat(job.hours) || 0;
      saveJob({ hours: currentHours + billableHours });
    }
  };

  const addManualBillableHours = async () => {
    const hours = parseFloat(manualHours);
    if (!Number.isFinite(hours) || hours <= 0) return;

    setAddingManualHours(true);
    try {
      const billableHours = Math.round(hours * 100) / 100;
      const billableMinutes = Math.round(billableHours * 60);
      const now = Date.now();

      await addDoc(workSessionsPath, {
        manual: true,
        startMs: now,
        endMs: now,
        durationMinutes: billableMinutes,
        billableMinutes,
        billableHours,
      });

      const currentHours = parseFloat(job.hours) || 0;
      saveJob({ hours: Math.round((currentHours + billableHours) * 100) / 100 });
      setManualHours("");
    } finally {
      setAddingManualHours(false);
    }
  };

  return (
    <div>
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
      {editing ? (
        <Card>
          <Input label="Title" value={form.title} onChange={f("title")} />
          <Select label="Customer" value={form.customerId} onChange={f("customerId")} options={data.customers.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Date" value={form.date} onChange={f("date")} type="date" />
          <Select label="Status" value={form.status} onChange={f("status")} options={STATUSES} />
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <Input label="Flat Rate ($)" value={form.price || ""} onChange={f("price")} type="number" placeholder="0.00" />
            <div /> {/* spacer */}
            <Input label="Hourly Rate ($/hr)" value={form.hourlyRate || ""} onChange={f("hourlyRate")} type="number" placeholder="0.00" />
            <Input label="Hours" value={form.hours || ""} onChange={f("hours")} type="number" placeholder="0" />
          </div>
          {((parseFloat(form.hourlyRate) || 0) > 0 || (parseFloat(form.price) || 0) > 0) && (
            <div style={{ fontSize: 13, color: "#7f8c8d", marginBottom: 12, marginTop: -4 }}>
              Total revenue: <strong>${(
                (parseFloat(form.price) || 0) +
                (parseFloat(form.hourlyRate) || 0) * (parseFloat(form.hours) || 0)
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
            <Btn onClick={() => { saveJob(form); setEditing(false); }}>Save</Btn>
            <Btn color="#7f8c8d" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 700 }}>Job Details</span>
            <Btn small onClick={() => setEditing(true)}>Edit</Btn>
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
              <span style={{ fontSize: 13 }}>${(parseFloat(job.hourlyRate) || 0).toFixed(2)}/hr × {parseFloat(job.hours) || 0} hrs = ${hourlyTotal.toFixed(2)}</span>
            </div>
          )}

          <div style={{ marginTop: 12, borderTop: "1px solid #ecf0f1", paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>⏱️ Billable work time</div>
                <div style={{ fontSize: 12, color: "#7f8c8d" }}>Increments by full 30-minute chunks (round down).</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {!activeSession ? (
                  <Btn onClick={startWork}>Start</Btn>
                ) : (
                  <Btn color="#c0392b" onClick={stopWork}>
                    Stop
                  </Btn>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
              <div style={{ flex: "1 1 140px", maxWidth: 200 }}>
                <Input
                  label="Add billable hours"
                  value={manualHours}
                  onChange={setManualHours}
                  type="number"
                  placeholder="0.5"
                  step="0.5"
                  min="0"
                />
              </div>
              <Btn
                onClick={addManualBillableHours}
                disabled={addingManualHours || !(parseFloat(manualHours) > 0)}
              >
                {addingManualHours ? "Adding…" : "Add hours"}
              </Btn>
            </div>

            {activeSession ? (
              <div style={{ marginBottom: 10, fontSize: 13, color: "#232323" }}>
                Active shift started: <span style={{ fontWeight: 700 }}>{formatMs(activeSession.startMs)}</span>
              </div>
            ) : (
              <div style={{ marginBottom: 10, fontSize: 13, color: "#7f8c8d" }}>No active shift.</div>
            )}

            {sessions.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#7f8c8d", marginBottom: 8 }}>Recent sessions</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                  {sessions.map((s) => {
                    const ended = s.endMs != null;
                    const billableHours = parseFloat(s.billableHours) || 0;
                    const isManual = !!s.manual;
                    return (
                      <div key={s.id} style={{ border: "1px solid #ecf0f1", borderRadius: 10, padding: 10, background: "#fff" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                          {isManual ? "Manual entry" : ended ? "Completed" : "Running"}
                        </div>
                        {!isManual ? (
                          <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 6 }}>Start: {formatMs(s.startMs)}</div>
                        ) : null}
                        {ended && !isManual ? (
                          <>
                            <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 6 }}>End: {formatMs(s.endMs)}</div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>
                              Billable: {billableHours} hrs ({parseFloat(s.billableMinutes) || 0} min)
                            </div>
                          </>
                        ) : isManual ? (
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            Billable: {billableHours} hrs ({parseFloat(s.billableMinutes) || 0} min)
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#7f8c8d" }}>Will be billed when stopped.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

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
    </div>
  );
}
