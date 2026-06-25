import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import {
  contiguousSlotKeysInRange,
  expandSlots,
  groupSlotsByDayContiguous,
  localDateFromDayKey,
  mergeContiguousSlotRange,
  slotKey,
} from "../../utils/bookingSlots";
import { findConflictingBooking, formatBookingConflictMessage } from "../../utils/bookingConflicts";
import Btn from "../ui/Btn";
import Input from "../ui/Input";
import Card from "../ui/Card";
import TaskMultiPicker from "../ui/TaskMultiPicker";
import ClientStepper from "./ClientStepper";
import { colors, pageWrap, sectionTitle } from "./clientTheme";

const STEPS = [
  { id: "details", label: "Details" },
  { id: "time", label: "Time" },
  { id: "submit", label: "Submit" },
];

function formatRange(start, end) {
  const opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function formatSlotLabel(slot) {
  const opts = { hour: "numeric", minute: "2-digit" };
  return `${slot.start.toLocaleTimeString(undefined, opts)} – ${slot.end.toLocaleTimeString(undefined, opts)}`;
}

const CHAIN_EPS_MS = 8;

function approxSameInstant(aMs, bMs) {
  return Math.abs(aMs - bMs) <= CHAIN_EPS_MS;
}

function sameSlot(a, b) {
  return a && b && approxSameInstant(a.start.getTime(), b.start.getTime());
}

function singleSlotRange(slot) {
  return {
    availabilityId: slot.availabilityId,
    start: slot.start,
    end: slot.end,
  };
}

function boundsFromMerge(m, allSlots) {
  if (!m) return null;
  const lo = allSlots.find((s) => approxSameInstant(s.start.getTime(), m.start.getTime()));
  const hi = allSlots.find((s) => approxSameInstant(s.end.getTime(), m.end.getTime()));
  if (!lo || !hi) return null;
  return { lo, hi };
}

function slotsInRuns(runs) {
  return runs.reduce((n, run) => n + run.length, 0);
}

function durationMinutesFromRange(range) {
  if (!range) return 0;
  return Math.round((range.end.getTime() - range.start.getTime()) / 60000);
}

export default function ClientBookingFlow({ user, profile, profileLoading }) {
  const [availability, setAvailability] = useState([]);
  const [selectedRange, setSelectedRange] = useState(null);
  /** First tap when building a range; cleared once range is finalized. */
  const [rangeAnchor, setRangeAnchor] = useState(null);
  const [title, setTitle] = useState("");
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [taskCatalog, setTaskCatalog] = useState([]);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState("details");
  const [openDayKey, setOpenDayKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [doneMessage, setDoneMessage] = useState(null);

  useEffect(() => {
    if (profileLoading) return;
    const addr = (profile?.address || "").trim();
    const ph = (profile?.phone || "").trim();
    setLocation((v) => (v.trim() === "" ? addr : v));
    setPhone((v) => (v.trim() === "" ? ph : v));
  }, [profile, profileLoading]);

  useEffect(() => {
    if (!user) {
      setAvailability([]);
      return;
    }
    const q = query(
      collection(db, "availability"),
      where("status", "==", "open"),
      orderBy("start", "asc")
    );
    return onSnapshot(
      q,
      (snap) =>
        setAvailability(
          snap.docs.map((d) => ({ ...d.data(), id: d.id }))
        ),
      (err) => console.error("availability listener", err)
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setTaskCatalog([]);
      return;
    }
    const q = collection(db, "taskCatalog");
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, name: d.data().name || "" }));
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setTaskCatalog(rows);
      },
      (err) => console.error("taskCatalog listener", err)
    );
  }, [user]);

  const resolvedTitle = useMemo(() => {
    const manual = title.trim();
    if (manual) return manual;
    return selectedTasks.map((t) => t.name).join(", ");
  }, [title, selectedTasks]);

  const allSlots = useMemo(() => {
    const t = Date.now();
    const out = [];
    for (const a of availability) {
      for (const s of expandSlots(a)) {
        if (s.start.getTime() > t) out.push(s);
      }
    }
    out.sort((x, y) => x.start - y.start);
    return out;
  }, [availability]);

  const byDay = useMemo(() => groupSlotsByDayContiguous(allSlots), [allSlots]);

  const selectedSlotKeys = useMemo(() => {
    if (rangeAnchor) return new Set([slotKey(rangeAnchor)]);
    if (!selectedRange) return new Set();
    const bounds = boundsFromMerge(selectedRange, allSlots);
    if (!bounds) return new Set();
    return contiguousSlotKeysInRange(allSlots, bounds.lo, bounds.hi);
  }, [rangeAnchor, selectedRange, allSlots]);

  useEffect(() => {
    if (step !== "time" || openDayKey || !byDay.length) return;
    const first = byDay.find(([, runs]) => slotsInRuns(runs) > 0);
    if (first) setOpenDayKey(first[0]);
  }, [step, byDay, openDayKey]);

  const resetAfterSubmit = () => {
    setSelectedRange(null);
    setRangeAnchor(null);
    setTitle("");
    setSelectedTasks([]);
    setNotes("");
    setFormError(null);
    setStep("details");
    setOpenDayKey(null);
    const addr = (profile?.address || "").trim();
    const ph = (profile?.phone || "").trim();
    setLocation(addr);
    setPhone(ph);
  };

  const continueToTime = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!resolvedTitle) {
      setFormError("Add a short title or pick at least one task.");
      return;
    }
    if (!location.trim()) {
      setFormError("Add a location or address.");
      return;
    }
    if (!phone.trim()) {
      setFormError("Add a phone number.");
      return;
    }
    setStep("time");
    setOpenDayKey(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearSelection = () => {
    setSelectedRange(null);
    setRangeAnchor(null);
    setFormError(null);
  };

  const onSlotClick = (slot) => {
    setFormError(null);

    if (rangeAnchor) {
      if (sameSlot(rangeAnchor, slot)) {
        setSelectedRange(singleSlotRange(slot));
        setRangeAnchor(null);
        return;
      }
      const merged = mergeContiguousSlotRange(rangeAnchor, slot, allSlots);
      if (merged) {
        setSelectedRange(merged);
        setRangeAnchor(null);
        return;
      }
      setRangeAnchor(slot);
      setSelectedRange(null);
      return;
    }

    if (selectedRange) {
      const bounds = boundsFromMerge(selectedRange, allSlots);
      if (bounds) {
        if (sameSlot(bounds.lo, slot) || sameSlot(bounds.hi, slot)) {
          setRangeAnchor(slot);
          setSelectedRange(null);
          return;
        }
        const merged =
          mergeContiguousSlotRange(bounds.lo, slot, allSlots) ||
          mergeContiguousSlotRange(bounds.hi, slot, allSlots);
        if (merged) {
          setSelectedRange(merged);
          return;
        }
      }
    }

    setRangeAnchor(slot);
    setSelectedRange(null);
  };

  const goToSubmit = () => {
    if (!selectedRange) {
      setFormError("Choose a time first.");
      return;
    }
    setFormError(null);
    setStep("submit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedRange) {
      setFormError("Choose a time first.");
      return;
    }
    if (!resolvedTitle || !location.trim() || !phone.trim()) {
      setFormError("Complete all required fields.");
      return;
    }

    const startMs = selectedRange.start.getTime();
    const endMs = selectedRange.end.getTime();
    const durationMinutes = durationMinutesFromRange(selectedRange);

    setSubmitting(true);
    try {
      const [pendingSnap, approvedSnap] = await Promise.all([
        getDocs(query(collection(db, "bookingRequests"), where("status", "==", "pending"))),
        getDocs(query(collection(db, "bookingRequests"), where("status", "==", "approved"))),
      ]);
      const existing = [
        ...pendingSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ...approvedSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ];
      if (findConflictingBooking(existing, startMs, endMs)) {
        setFormError(formatBookingConflictMessage());
        return;
      }

      const clientName =
        (profile?.displayName || "").trim() || (user.displayName || "").trim() || "";
      await addDoc(collection(db, "bookingRequests"), {
        clientUid: user.uid,
        availabilityId: selectedRange.availabilityId,
        requestedStart: Timestamp.fromDate(selectedRange.start),
        requestedEnd: Timestamp.fromDate(selectedRange.end),
        requestedDurationMinutes: durationMinutes,
        title: resolvedTitle,
        requestedTasks: selectedTasks.map((t) => ({
          taskCatalogId: t.taskDefId,
          name: t.name,
        })),
        location: location.trim(),
        phone: phone.trim(),
        clientName,
        notes: notes.trim(),
        status: "pending",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setDoneMessage("Request sent! Check Profile for status updates.");
      resetAfterSubmit();
    } catch (err) {
      setFormError(err?.message || "Could not submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const stepperId = step === "submit" ? "submit" : step;
  const durationMins = durationMinutesFromRange(selectedRange);

  const slotBtnStyle = (slot, picked, inRange, waitingForEnd) => ({
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: 8,
    border: picked
      ? `2px solid ${colors.accent}`
      : inRange
        ? `2px solid ${colors.accent}`
        : waitingForEnd
          ? `1px dashed ${colors.accent}`
          : `1px solid ${colors.border}`,
    background: picked || inRange ? colors.accentSoft : "#fff",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 14,
    color: colors.text,
    fontWeight: picked ? 700 : 400,
    width: "100%",
  });

  return (
    <div style={pageWrap}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>
          Request a booking
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#555", lineHeight: 1.45 }}>
          Save your contact info under <strong>Profile</strong> so it fills in automatically next time.
        </p>
      </header>

      <ClientStepper steps={STEPS} currentId={stepperId} />

      {doneMessage && (
        <Card style={{ marginBottom: 16, background: colors.successSoft, border: `1px solid ${colors.success}` }}>
          <p style={{ margin: 0, color: "#1e8449", fontWeight: 600 }}>{doneMessage}</p>
          <button
            type="button"
            onClick={() => setDoneMessage(null)}
            style={{
              marginTop: 10,
              background: "transparent",
              border: "none",
              color: "#1e8449",
              textDecoration: "underline",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
        </Card>
      )}

      {step === "details" && (
        <>
          <h2 style={sectionTitle}>What do you need?</h2>
          <Card>
            <form onSubmit={continueToTime}>
              <Input
                label="Title"
                value={title}
                onChange={setTitle}
                placeholder={selectedTasks.length ? "Optional — defaults to selected tasks" : "e.g. Kitchen faucet repair"}
              />
              <Input
                label="Location / address"
                value={location}
                onChange={setLocation}
                placeholder="Where should we meet?"
              />
              <Input
                label="Phone"
                type="tel"
                value={phone}
                onChange={setPhone}
                placeholder="Best number to reach you"
              />
              <Input
                label="Notes (optional)"
                value={notes}
                onChange={setNotes}
                placeholder="Access, pets, materials, etc."
              />
              <TaskMultiPicker
                label="Tasks (optional)"
                placeholder="Search saved tasks…"
                options={taskCatalog}
                value={selectedTasks}
                onChange={setSelectedTasks}
                buildItem={(t) => ({ id: t.id, taskDefId: t.id, name: t.name })}
                hint="Pick from our task list, or describe the work in the title above."
                labelStyle={{ color: colors.mmuted }}
              />
              {formError && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.danger }} role="alert">
                  {formError}
                </p>
              )}
              <Btn type="submit">Continue to times →</Btn>
            </form>
          </Card>
        </>
      )}

      {step === "time" && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: colors.mmuted, marginBottom: 4 }}>Your request</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{resolvedTitle}</div>
                {selectedTasks.length > 0 && (
                  <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
                    {selectedTasks.map((t) => t.name).join(" · ")}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#555" }}>{location}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setStep("details");
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                Edit
              </button>
            </div>
          </Card>

          <h2 style={sectionTitle}>Pick your time</h2>
          <Card style={{ marginBottom: 14, background: "#f8f9fa", border: `1px solid ${colors.border}` }}>
            <p style={{ margin: 0, fontSize: 14, color: "#555", lineHeight: 1.5 }}>
              <strong>One hour:</strong> tap a time block twice (start, then same block again).
              <br />
              <strong>Longer visit:</strong> tap the start block, then tap the end block — every hour in between is included.
            </p>
          </Card>

          {rangeAnchor ? (
            <Card style={{ marginBottom: 14, background: colors.accentSoft, border: `2px dashed ${colors.accent}` }}>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Start time</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
                {formatSlotLabel(rangeAnchor)}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: colors.text, fontWeight: 600 }}>
                Tap your end time to include every hour in between — or tap this same block again for one hour.
              </p>
            </Card>
          ) : null}

          {selectedRange && !rangeAnchor && (
            <Card style={{ marginBottom: 14, background: colors.accentSoft, border: `2px solid ${colors.accent}` }}>
              <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>Selected</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                {formatRange(selectedRange.start, selectedRange.end)}
              </div>
              <div style={{ fontSize: 13, color: colors.mmuted, marginBottom: 12 }}>
                {durationMins >= 60
                  ? `${durationMins / 60} hour${durationMins === 60 ? "" : "s"}`
                  : `${durationMins} minutes`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Btn onClick={goToSubmit}>Review & submit →</Btn>
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.text,
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 13,
                    padding: "10px 0",
                  }}
                >
                  Clear selection
                </button>
              </div>
            </Card>
          )}

          {!selectedRange && !rangeAnchor ? (
            <p style={{ margin: "0 0 14px", fontSize: 13, color: colors.mmuted }}>
              Tap a time block below to begin.
            </p>
          ) : null}

          {byDay.length === 0 ? (
            <Card>
              <p style={{ margin: 0, color: colors.mmuted }}>
                No open times right now. Check back later or call us directly.
              </p>
            </Card>
          ) : (
            byDay.map(([day, runs]) => {
              const open = openDayKey === day;
              const slotCount = slotsInRuns(runs);
              const label = localDateFromDayKey(day).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              });
              return (
                <Card key={day} style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => setOpenDayKey((k) => (k === day ? null : day))}
                    aria-expanded={open}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      fontWeight: 700,
                      marginBottom: open ? 12 : 0,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 15,
                      color: colors.text,
                    }}
                  >
                    <span>{label}</span>
                    <span style={{ fontSize: 12, color: colors.mmuted }}>
                      {slotCount === 0 ? "No slots" : open ? "Hide ▲" : `${slotCount} slot${slotCount === 1 ? "" : "s"} ▼`}
                    </span>
                  </button>
                  {open ? (
                    slotCount === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: colors.mmuted }}>No slots this day.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {runs.map((run, ri) => (
                          <div key={ri}>
                            {runs.length > 1 ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: colors.mmuted,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                  marginBottom: 6,
                                }}
                              >
                                Block {ri + 1}
                              </div>
                            ) : null}
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                gap: 8,
                              }}
                            >
                              {run.map((slot) => {
                                const key = slotKey(slot);
                                const inRange = selectedSlotKeys.has(key);
                                const bounds = selectedRange
                                  ? boundsFromMerge(selectedRange, allSlots)
                                  : null;
                                const picked =
                                  (rangeAnchor && sameSlot(rangeAnchor, slot)) ||
                                  (bounds &&
                                    (sameSlot(bounds.lo, slot) || sameSlot(bounds.hi, slot)));
                                const waitingForEnd = rangeAnchor && sameSlot(rangeAnchor, slot);
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onClick={() => onSlotClick(slot)}
                                    style={slotBtnStyle(slot, picked, inRange && !picked, waitingForEnd)}
                                  >
                                    {formatSlotLabel(slot)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : null}
                </Card>
              );
            })
          )}

          {formError && (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.danger }} role="alert">
              {formError}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={goToSubmit} disabled={!selectedRange || !!rangeAnchor}>
              Review & submit →
            </Btn>
            <Btn color="#7f8c8d" onClick={() => setStep("details")}>
              Back
            </Btn>
          </div>
        </>
      )}

      {step === "submit" && (
        <>
          <h2 style={sectionTitle}>Review & submit</h2>
          <Card style={{ marginBottom: 16 }}>
            <dl style={{ margin: 0, fontSize: 14 }}>
              {[
                ["Job", resolvedTitle],
                ...(selectedTasks.length > 1
                  ? [["Tasks", selectedTasks.map((t) => t.name).join(", ")]]
                  : []),
                ["When", selectedRange ? formatRange(selectedRange.start, selectedRange.end) : "—"],
                [
                  "Duration",
                  selectedRange
                    ? durationMins >= 60
                      ? `${durationMins / 60} hr`
                      : `${durationMins} min`
                    : "—",
                ],
                ["Location", location],
                ["Phone", phone],
                ...(notes.trim() ? [["Notes", notes.trim()]] : []),
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "8px 0",
                    borderBottom: "1px solid #ecf0f1",
                  }}
                >
                  <dt style={{ margin: 0, color: colors.mmuted, flexShrink: 0 }}>{label}</dt>
                  <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{value}</dd>
                </div>
              ))}
            </dl>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setStep("time")}
                style={{
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Change time
              </button>
              <button
                type="button"
                onClick={() => setStep("details")}
                style={{
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Edit details
              </button>
            </div>
          </Card>

          <Card>
            <form onSubmit={submit}>
              <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
                Submitting sends a request — not a confirmed appointment. You'll get an update once it's reviewed.
              </p>
              {formError && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.danger }} role="alert">
                  {formError}
                </p>
              )}
              <Btn type="submit" disabled={submitting || !selectedRange} style={{ width: "100%" }}>
                {submitting ? "Sending…" : "Submit booking request"}
              </Btn>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
