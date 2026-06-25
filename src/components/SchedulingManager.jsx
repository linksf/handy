import { useMemo, useState, useEffect } from "react";
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  dayKey,
  eachLocalCalendarDayInclusive,
  localMidnight,
  projectAvailabilityToLocalDay,
  splitTimeWindowIntoSlotChunks,
} from "../utils/bookingSlots";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Badge from "./ui/Badge";

const WEEKDAY_TOGGLE = [
  { d: 0, label: "Sun" },
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
];

function noonLocalFromDateInput(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  return new Date(`${yyyyMmDd}T12:00:00`);
}

function duplicateBlockExists(existingRows, start, end, slotMins) {
  const dk = dayKey(start);
  return existingRows.some((row) => {
    if (!row.start?.toDate || !row.end?.toDate) return false;
    const rs = row.start.toDate();
    const re = row.end.toDate();
    if (dayKey(rs) !== dk) return false;
    const sameStart = Math.abs(rs.getTime() - start.getTime()) < 45000;
    const sameEnd = Math.abs(re.getTime() - end.getTime()) < 45000;
    const sameSlot = (row.slotDurationMinutes || 60) === slotMins;
    return sameStart && sameEnd && sameSlot;
  });
}

function formatTs(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDayHeaderFromKey(k) {
  const [y, m, d] = String(k).split("-").map((n) => parseInt(n, 10));
  if ([y, m, d].some((n) => Number.isNaN(n))) return k;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Apply the clock time of `timeSource` onto the same calendar day as `day`. */
function applyTimeToDay(day, timeSource) {
  const t = new Date(timeSource);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
    t.getMilliseconds()
  );
}

function localMidnightFromYyyyMmDd(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = String(yyyyMmDd).split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

const SLOT_DOC_BATCH = 400;

export default function SchedulingManager({ ctx }) {
  const { availability, bookingRequests, showToast, approveBookingRequest, nav } = ctx;
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [slotDuration, setSlotDuration] = useState("60");
  const [addRepeatThrough, setAddRepeatThrough] = useState("");
  const [addRepeatWeekdays, setAddRepeatWeekdays] = useState(() => [true, true, true, true, true, true, true]);
  const [addSkipDuplicates, setAddSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);

  const [copySourceId, setCopySourceId] = useState("");
  const [copyRangeFrom, setCopyRangeFrom] = useState("");
  const [copyRangeTo, setCopyRangeTo] = useState("");
  const [copyWeekdays, setCopyWeekdays] = useState(() => [true, true, true, true, true, true, true]);
  const [copySkipTemplateDay, setCopySkipTemplateDay] = useState(true);
  const [copySkipDuplicates, setCopySkipDuplicates] = useState(true);
  const [copyBusy, setCopyBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [expandedDays, setExpandedDays] = useState({});

  const requestsSorted = useMemo(() => {
    return bookingRequests
      .filter((r) => r.status === "pending")
      .sort(
        (a, b) =>
          (a.requestedStart?.toMillis?.() || 0) - (b.requestedStart?.toMillis?.() || 0)
      );
  }, [bookingRequests]);

  const availableByDay = useMemo(() => {
    const onlyOpen = availability.filter((row) => row.status === "open");
    const map = new Map();
    for (const row of onlyOpen) {
      const startDate = row.start?.toDate?.();
      if (!startDate) continue;
      const k = dayKey(startDate);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    const out = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, rows] of out) {
      rows.sort(
        (a, b) =>
          (a.start?.toMillis?.() || 0) - (b.start?.toMillis?.() || 0)
      );
    }
    return out;
  }, [availability]);

  useEffect(() => {
    setExpandedDays((prev) => {
      const next = {};
      for (const [k] of availableByDay) {
        next[k] = !!prev[k];
      }
      return next;
    });
  }, [availableByDay]);

  const toggleDayExpanded = (k) => {
    setExpandedDays((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const slotMinsParsed = Math.max(15, parseInt(slotDuration, 10) || 60);

  const addFormPreview = useMemo(() => {
    if (!start || !end) return null;
    const s = new Date(start);
    const en = new Date(end);
    if (!(en > s)) return { error: "End must be after start." };
    if (dayKey(s) !== dayKey(en)) {
      return { error: "Start and end must be the same calendar day (use “Repeat through” for more days)." };
    }
    const perDay = splitTimeWindowIntoSlotChunks(s, en, slotMinsParsed).length;
    if (perDay === 0) {
      return { error: "Window is too short for that slot length." };
    }
    let dayCount = 0;
    const first = localMidnight(s);
    const last = addRepeatThrough
      ? localMidnightFromYyyyMmDd(addRepeatThrough)
      : first;
    if (!last || last < first) {
      return { error: "Repeat through must be on or after the start date." };
    }
    const useWeekdayFilter = !!addRepeatThrough;
    for (const d of eachLocalCalendarDayInclusive(first, last)) {
      if (useWeekdayFilter && !addRepeatWeekdays[d.getDay()]) continue;
      dayCount += 1;
    }
    if (dayCount === 0) {
      return { error: "No days match — turn on weekdays that include your range." };
    }
    return { perDay, dayCount, total: perDay * dayCount };
  }, [start, end, slotMinsParsed, addRepeatThrough, addRepeatWeekdays]);

  const toggleAddWeekday = (index) => {
    setAddRepeatWeekdays((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const addBlock = async (e) => {
    e.preventDefault();
    if (!start || !end) {
      showToast("Set start and end times.");
      return;
    }
    const s = new Date(start);
    const en = new Date(end);
    if (!(en > s)) {
      showToast("End must be after start.");
      return;
    }
    if (dayKey(s) !== dayKey(en)) {
      showToast("Start and end must be the same day, or use Repeat through for more days.");
      return;
    }
    const first = localMidnight(s);
    const last = addRepeatThrough
      ? localMidnightFromYyyyMmDd(addRepeatThrough)
      : first;
    if (addRepeatThrough && (!last || last < first)) {
      showToast("Repeat through must be on or after the start date.");
      return;
    }
    const useWeekdayFilter = !!addRepeatThrough;
    const slotMins = slotMinsParsed;
    setBusy(true);
    try {
      const dayWork = [];
      for (const d of eachLocalCalendarDayInclusive(first, last)) {
        if (useWeekdayFilter && !addRepeatWeekdays[d.getDay()]) continue;
        const dayStart = applyTimeToDay(d, s);
        const dayEnd = applyTimeToDay(d, en);
        if (!(dayEnd > dayStart)) {
          showToast("Invalid time range on " + d.toLocaleDateString());
          return;
        }
        const chunks = splitTimeWindowIntoSlotChunks(dayStart, dayEnd, slotMins);
        for (const ch of chunks) {
          if (addSkipDuplicates && duplicateBlockExists(availability, ch.start, ch.end, slotMins)) {
            continue;
          }
          dayWork.push(ch);
        }
      }
      if (dayWork.length === 0) {
        showToast("Nothing to add (all slots already exist, or no days matched your weekdays).");
        return;
      }
      const colRef = collection(db, "availability");
      let batch = writeBatch(db);
      let n = 0;
      for (const ch of dayWork) {
        const r = doc(colRef);
        batch.set(r, {
          start: Timestamp.fromDate(ch.start),
          end: Timestamp.fromDate(ch.end),
          slotDurationMinutes: slotMins,
          status: "open",
          label: label.trim(),
          createdAt: serverTimestamp(),
        });
        n += 1;
        if (n >= SLOT_DOC_BATCH) {
          await batch.commit();
          batch = writeBatch(db);
          n = 0;
        }
      }
      if (n > 0) {
        await batch.commit();
      }
      setLabel("");
      setStart("");
      setEnd("");
      setAddRepeatThrough("");
      showToast(
        dayWork.length === 1
          ? "Added 1 time window."
          : `Added ${dayWork.length} time windows.`
      );
    } catch (err) {
      console.error(err);
      showToast("Could not save availability.");
    } finally {
      setBusy(false);
    }
  };

  const removeBlock = async (id) => {
    if (!window.confirm("Delete this availability block?")) return;
    try {
      await deleteDoc(doc(db, "availability", id));
      showToast("Deleted.");
    } catch (err) {
      console.error(err);
      showToast("Could not delete.");
    }
  };

  const toggleWeekday = (index) => {
    setCopyWeekdays((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const replicatePattern = async (e) => {
    e.preventDefault();
    const template = availability.find((a) => a.id === copySourceId);
    if (!template?.start?.toDate || !template?.end?.toDate) {
      showToast("Choose a block to copy from the list.");
      return;
    }
    const first = noonLocalFromDateInput(copyRangeFrom);
    const last = noonLocalFromDateInput(copyRangeTo);
    if (!first || !last) {
      showToast("Set both start and end dates for the range.");
      return;
    }
    if (last < first) {
      showToast("End date must be on or after start date.");
      return;
    }
    const slotMins = Math.max(15, parseInt(String(template.slotDurationMinutes), 10) || 60);
    const templateDayKey = dayKey(template.start.toDate());

    setCopyBusy(true);
    try {
      const work = [];
      for (const dayMidnight of eachLocalCalendarDayInclusive(first, last)) {
        const dow = dayMidnight.getDay();
        if (!copyWeekdays[dow]) continue;

        const { start: ns, end: ne } = projectAvailabilityToLocalDay(
          template.start,
          template.end,
          dayMidnight
        );
        if (copySkipTemplateDay && dayKey(ns) === templateDayKey) continue;

        const chunks = splitTimeWindowIntoSlotChunks(ns, ne, slotMins);
        for (const ch of chunks) {
          if (copySkipDuplicates && duplicateBlockExists(availability, ch.start, ch.end, slotMins)) {
            continue;
          }
          work.push(ch);
        }
      }
      if (work.length === 0) {
        showToast("No new blocks. Widen the date range, enable more weekdays, or turn off the skip options.");
        return;
      }
      const colRef = collection(db, "availability");
      let batch = writeBatch(db);
      let n = 0;
      const lbl = (template.label || "").trim();
      for (const ch of work) {
        const r = doc(colRef);
        batch.set(r, {
          start: Timestamp.fromDate(ch.start),
          end: Timestamp.fromDate(ch.end),
          slotDurationMinutes: slotMins,
          status: "open",
          label: lbl,
          createdAt: serverTimestamp(),
        });
        n += 1;
        if (n >= SLOT_DOC_BATCH) {
          await batch.commit();
          batch = writeBatch(db);
          n = 0;
        }
      }
      if (n > 0) {
        await batch.commit();
      }
      showToast(
        `Added ${work.length} time window${work.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      console.error(err);
      showToast("Could not copy pattern.");
    } finally {
      setCopyBusy(false);
    }
  };

  const toggleClosed = async (row) => {
    try {
      await updateDoc(doc(db, "availability", row.id), {
        status: row.status === "open" ? "closed" : "open",
      });
      showToast(row.status === "open" ? "Marked closed (hidden from clients)." : "Opened to clients.");
    } catch (err) {
      console.error(err);
      showToast("Could not update.");
    }
  };

  const setRequestStatus = async (request, status) => {
    try {
      if (status === "approved") {
        setActionBusyId(request.id);
        const ok = await approveBookingRequest(request);
        if (!ok) return;
        return;
      }
      await updateDoc(doc(db, "bookingRequests", request.id), {
        status,
        updatedAt: serverTimestamp(),
      });
      showToast("Declined.");
    } catch (err) {
      console.error(err);
      showToast("Could not update request.");
    } finally {
      setActionBusyId(null);
    }
  };

  const bookingRequestsSection = (
    <Card style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0, color: "#232323" }}>Pending booking requests</h3>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
        <strong>Approve</strong> creates the customer (or matches by phone), schedules a job with the client&apos;s
        selected tasks, and links it here. Use <strong>Open job</strong> to review tasks and the packing checklist.
      </p>
      {requestsSorted.length === 0 ? (
        <p style={{ color: "#7f8c8d", margin: 0 }}>No pending requests.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #bdc3c7" }}>
                <th style={{ padding: "8px 6px" }}>When</th>
                <th style={{ padding: "8px 6px" }}>Title</th>
                <th style={{ padding: "8px 6px" }}>Location</th>
                <th style={{ padding: "8px 6px" }}>Phone</th>
                <th style={{ padding: "8px 6px" }} />
              </tr>
            </thead>
            <tbody>
              {requestsSorted.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #ecf0f1", verticalAlign: "top" }}>
                  <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                    {formatTs(r.requestedStart)}
                    <div style={{ fontSize: 12, color: "#7f8c8d" }}>to {formatTs(r.requestedEnd)}</div>
                  </td>
                  <td style={{ padding: "10px 6px", maxWidth: 200 }}>
                    <div style={{ fontWeight: 600 }}>{r.title}</div>
                    {r.clientName ? (
                      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{r.clientName}</div>
                    ) : null}
                    {r.notes ? <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{r.notes}</div> : null}
                    {(r.requestedTasks || []).length > 0 ? (
                      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                        Tasks: {(r.requestedTasks || []).map((t) => t.name).join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "10px 6px" }}>{r.location}</td>
                  <td style={{ padding: "10px 6px" }}>{r.phone}</td>
                  <td style={{ padding: "10px 6px" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Btn
                        small
                        onClick={() => setRequestStatus(r, "approved")}
                        disabled={actionBusyId === r.id}
                      >
                        {actionBusyId === r.id ? "…" : "Approve"}
                      </Btn>
                      <Btn
                        small
                        danger
                        onClick={() => setRequestStatus(r, "declined")}
                        disabled={actionBusyId === r.id}
                      >
                        Decline
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <h2 style={{ marginTop: 0, color: "#232323", fontWeight: 700 }}>Scheduling</h2>
      <p style={{ color: "#555", marginTop: 0, marginBottom: 20, lineHeight: 1.5 }}>
        Add bookable windows and review client requests. Clients only see blocks marked open.         Public link:{" "}
        <a href="/" style={{ color: "#2980b9", fontWeight: 600 }}>
          home (/)
        </a>
      </p>

      {bookingRequestsSection}

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, color: "#232323" }}>Availability blocks</h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          Enter <strong>Start</strong> and <strong>End</strong> on the <strong>same day</strong>, plus a slot length.
          A 10:00–22:00 window with 60 min slots is saved as <strong>12 separate rows</strong> (one per hour), not one
          12-hour row. <strong>Repeat through</strong> reuses those hours across a date range; use weekdays when repeating.
        </p>
        <form onSubmit={addBlock}>
          <Input label="Label (optional)" value={label} onChange={setLabel} placeholder="e.g. March weekdays" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>Start</div>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, minHeight: 44 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>End (same day)</div>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, minHeight: 44 }}
              />
            </div>
          </div>
          <Input label="Slot length (minutes)" value={slotDuration} onChange={setSlotDuration} placeholder="60" />
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>Repeat through (optional)</div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "#7f8c8d", lineHeight: 1.4 }}>
              Leave empty to add only the day shown in <strong>Start</strong>. Set an end date to add the <em>same hours</em> on every date in the range.
            </p>
            <input
              type="date"
              value={addRepeatThrough}
              onChange={(e) => setAddRepeatThrough(e.target.value)}
              style={{ width: "100%", maxWidth: 320, boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, minHeight: 44 }}
            />
          </div>
          {addRepeatThrough ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Include only these weekdays
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {WEEKDAY_TOGGLE.map(({ d, label: lbl }) => {
                  const on = addRepeatWeekdays[d];
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleAddWeekday(d)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: on ? "2px solid #f9bf3b" : "1px solid #bdc3c7",
                        background: on ? "#fffef5" : "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "#232323",
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#232323", marginBottom: 14, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={addSkipDuplicates}
              onChange={(e) => setAddSkipDuplicates(e.target.checked)}
            />
            Skip if an identical time window already exists
          </label>
          {addFormPreview?.error ? (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#c0392b" }} role="alert">
              {addFormPreview.error}
            </p>
          ) : addFormPreview ? (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#27ae60" }}>
              <strong>Preview:</strong> up to {addFormPreview.total} new row{addFormPreview.total === 1 ? "" : "s"}{" "}
              ({addFormPreview.perDay} per day × {addFormPreview.dayCount} {addFormPreview.dayCount === 1 ? "day" : "days"},
              {addSkipDuplicates ? " minus any skipped duplicates" : " duplicates allowed"}).
            </p>
          ) : null}
          <Btn type="submit" disabled={busy || !!addFormPreview?.error}>
            {busy ? "Saving…" : "Add time windows"}
          </Btn>
        </form>
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, color: "#232323" }}>Copy pattern to more days</h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          Pick any existing block (even a one-hour row). The same hours and slot length are copied to each day in the
          range; large windows are split into one row per bookable slot, same as “Add time windows”.
        </p>
        <form onSubmit={replicatePattern}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Copy from block
            </div>
            <select
              value={copySourceId}
              onChange={(e) => setCopySourceId(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "100%",
                boxSizing: "border-box",
                border: "1px solid #bdc3c7",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 15,
                fontFamily: "inherit",
                background: "#fff",
                color: "#232323",
              }}
            >
              <option value="">— Select a block —</option>
              {availability.map((row) => (
                <option key={row.id} value={row.id}>
                  {(row.label || "Untitled").slice(0, 40)}
                  {(row.label || "").length > 40 ? "…" : ""} · {formatTs(row.start)} → {formatTs(row.end)} ·{" "}
                  {row.slotDurationMinutes || 60}m
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                From date
              </div>
              <input
                type="date"
                value={copyRangeFrom}
                onChange={(e) => setCopyRangeFrom(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, minHeight: 44 }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Through date
              </div>
              <input
                type="date"
                value={copyRangeTo}
                onChange={(e) => setCopyRangeTo(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "10px 12px", fontSize: 16, minHeight: 44 }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "#7f8c8d", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Include these weekdays
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WEEKDAY_TOGGLE.map(({ d, label }) => {
                const on = copyWeekdays[d];
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekday(d)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: on ? "2px solid #f9bf3b" : "1px solid #bdc3c7",
                      background: on ? "#fffef5" : "#fff",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "#232323",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#232323", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={copySkipTemplateDay}
                onChange={(e) => setCopySkipTemplateDay(e.target.checked)}
              />
              Skip the template block’s day (avoid duplicating the original date)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#232323", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={copySkipDuplicates}
                onChange={(e) => setCopySkipDuplicates(e.target.checked)}
              />
              Skip days that already have an identical block (same start, end, and slot length)
            </label>
          </div>
          <Btn type="submit" disabled={copyBusy || availability.length === 0}>
            {copyBusy ? "Creating…" : "Create blocks from pattern"}
          </Btn>
        </form>
      </Card>

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, color: "#232323" }}>Your blocks</h3>
        {availableByDay.length === 0 ? (
          <p style={{ color: "#7f8c8d", margin: 0 }}>No open slots yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {availableByDay.map(([k, rows]) => {
              const expanded = !!expandedDays[k];
              return (
                <div
                  key={k}
                  style={{
                    border: "1px solid #bdc3c7",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleDayExpanded(k)}
                    style={{
                      width: "100%",
                      border: "none",
                      background: "#f7f9fa",
                      color: "#232323",
                      padding: "12px 14px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>
                      {formatDayHeaderFromKey(k)}
                    </span>
                    <span style={{ fontSize: 13, color: "#555" }}>
                      {rows.length} slot{rows.length === 1 ? "" : "s"} {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {expanded ? (
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                      {rows.map((row) => (
                        <div
                          key={row.id}
                          style={{
                            border: "1px solid #bdc3c7",
                            borderRadius: 8,
                            padding: "10px 12px",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 10,
                            alignItems: "center",
                            justifyContent: "space-between",
                            background: "#fff",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>{row.label || "Untitled block"}</div>
                            <div style={{ fontSize: 13, color: "#555" }}>
                              {formatTs(row.start)} → {formatTs(row.end)} · {row.slotDurationMinutes || 60} min slots
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <Badge
                              text={row.status === "open" ? "Open" : "Closed"}
                              color={row.status === "open" ? "#d5f5e3" : "#fadbd8"}
                              textColor={row.status === "open" ? "#27ae60" : "#c0392b"}
                            />
                            <Btn small onClick={() => toggleClosed(row)}>
                              {row.status === "open" ? "Close" : "Open"}
                            </Btn>
                            <Btn small danger onClick={() => removeBlock(row.id)}>
                              Delete
                            </Btn>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
