import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  orderBy,
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
import ClientStepper from "./ClientStepper";
import { colors, pageWrap, sectionTitle } from "./clientTheme";

const STEPS = [
  { id: "setup", label: "Your info" },
  { id: "time", label: "Time" },
  { id: "submit", label: "Confirm" },
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

function durationMinutesFromRange(range) {
  if (!range) return 0;
  return Math.round((range.end.getTime() - range.start.getTime()) / 60000);
}

export default function ClientLeadFlow({
  token,
  user,
  profile,
  profileLoading,
  saveProfile,
  onDone,
}) {
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [claiming, setClaiming] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [step, setStep] = useState("setup");
  const [availability, setAvailability] = useState([]);
  const [selectedRange, setSelectedRange] = useState(null);
  const [rangeAnchor, setRangeAnchor] = useState(null);
  const [openDayKey, setOpenDayKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [doneMessage, setDoneMessage] = useState(null);

  const claimInvite = useCallback(async (data) => {
    if (!user?.uid || !token) return;
    if (data.clientUid && data.clientUid !== user.uid) {
      setLoadError("This request is linked to another account. Sign in with the correct email or contact us.");
      return;
    }
    if (!data.clientUid) {
      await updateDoc(doc(db, "leadInvites", token), {
        clientUid: user.uid,
        status: "claimed",
        updatedAt: serverTimestamp(),
      });
    }
  }, [token, user?.uid]);

  useEffect(() => {
    if (!token || !user?.uid) return;
    let cancelled = false;
    (async () => {
      setClaiming(true);
      setLoadError(null);
      try {
        const snap = await getDoc(doc(db, "leadInvites", token));
        if (!snap.exists()) {
          if (!cancelled) setLoadError("This link is invalid or expired.");
          return;
        }
        const data = { id: snap.id, ...snap.data() };
        if (data.status === "submitted") {
          if (!cancelled) {
            setInvite(data);
            setDoneMessage("You already submitted this request. Check Profile for updates.");
          }
          return;
        }
        await claimInvite(data);
        if (!cancelled) {
          setInvite(data);
          setDisplayName((data.name || "").trim() || user.displayName || "");
          setAddress((data.address || "").trim());
          setPhone((data.phone || "").trim());
          setNotes("");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setLoadError(err?.message || "Could not load your request.");
      } finally {
        if (!cancelled) setClaiming(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, user?.uid, user?.displayName, claimInvite]);

  useEffect(() => {
    if (profileLoading || !invite) return;
    if (!(profile?.displayName || "").trim() && invite.name) {
      setDisplayName((invite.name || "").trim());
    }
    if (!(profile?.address || "").trim() && invite.address) {
      setAddress((invite.address || "").trim());
    }
    if (!(profile?.phone || "").trim() && invite.phone) {
      setPhone((invite.phone || "").trim());
    }
  }, [profile, profileLoading, invite]);

  useEffect(() => {
    const q = query(
      collection(db, "availability"),
      where("status", "==", "open"),
      orderBy("start", "asc")
    );
    return onSnapshot(q, (snap) => {
      setAvailability(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

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

  useEffect(() => {
    if (openDayKey != null) return;
    const first = byDay.find(([, runs]) => runs.some((r) => r.length > 0));
    if (first) setOpenDayKey(first[0]);
  }, [byDay, openDayKey]);

  const selectedSlotKeys = useMemo(() => {
    if (!selectedRange) return new Set();
    return contiguousSlotKeysInRange(allSlots, selectedRange);
  }, [allSlots, selectedRange]);

  const onSlotClick = (slot) => {
    setFormError(null);
    if (!rangeAnchor) {
      setRangeAnchor(slot);
      setSelectedRange(singleSlotRange(slot));
      return;
    }
    if (sameSlot(rangeAnchor, slot)) {
      setSelectedRange(singleSlotRange(slot));
      setRangeAnchor(null);
      return;
    }
    const merged = mergeContiguousSlotRange(allSlots, rangeAnchor, slot);
    if (!merged) {
      setRangeAnchor(slot);
      setSelectedRange(singleSlotRange(slot));
      return;
    }
    setSelectedRange(merged);
    setRangeAnchor(null);
  };

  function singleSlotRange(slot) {
    return { availabilityId: slot.availabilityId, start: slot.start, end: slot.end };
  }

  const continueToTime = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!displayName.trim() || !address.trim() || !phone.trim()) {
      setFormError("Name, address, and phone are required.");
      return;
    }
    try {
      await saveProfile({ displayName, address, phone });
      setStep("time");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setFormError(err?.message || "Could not save profile.");
    }
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
    if (!invite || !selectedRange) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const startMs = selectedRange.start.getTime();
      const endMs = selectedRange.end.getTime();
      const durationMinutes = durationMinutesFromRange(selectedRange);

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

      const reqRef = await addDoc(collection(db, "bookingRequests"), {
        clientUid: user.uid,
        availabilityId: selectedRange.availabilityId,
        requestedStart: Timestamp.fromDate(selectedRange.start),
        requestedEnd: Timestamp.fromDate(selectedRange.end),
        requestedDurationMinutes: durationMinutes,
        title: (invite.jobTitle || "").trim() || "Job request",
        location: address.trim(),
        phone: phone.trim(),
        clientName: displayName.trim(),
        notes: [invite.jobNotes, notes.trim()].filter(Boolean).join("\n\n"),
        status: "pending",
        draftJobId: invite.jobId || null,
        leadInviteId: invite.id,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      await updateDoc(doc(db, "leadInvites", token), {
        status: "submitted",
        bookingRequestId: reqRef.id,
        updatedAt: serverTimestamp(),
      });

      setDoneMessage("Request sent! We'll confirm your time soon — check Profile for updates.");
      if (onDone) onDone();
    } catch (err) {
      setFormError(err?.message || "Could not submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (claiming) {
    return (
      <div style={{ ...pageWrap, textAlign: "center", paddingTop: 48 }}>
        <p style={{ color: colors.mmuted }}>Loading your request…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={pageWrap}>
        <Card style={{ border: `1px solid ${colors.danger}` }}>
          <p style={{ margin: 0, color: colors.danger }}>{loadError}</p>
        </Card>
      </div>
    );
  }

  if (!invite) return null;

  const stepperId = step;
  const durationMins = durationMinutesFromRange(selectedRange);

  return (
    <div style={pageWrap}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>
          Finish your booking
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#555", lineHeight: 1.45 }}>
          We received your request from Thumbtack. Confirm your details, pick a time, and submit.
        </p>
      </header>

      <ClientStepper steps={STEPS} currentId={stepperId} />

      {doneMessage && (
        <Card style={{ marginBottom: 16, background: colors.successSoft, border: `1px solid ${colors.success}` }}>
          <p style={{ margin: 0, color: "#1e8449", fontWeight: 600 }}>{doneMessage}</p>
        </Card>
      )}

      {!doneMessage && step === "setup" && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: colors.mmuted, marginBottom: 4 }}>Job</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{invite.jobTitle}</div>
            {invite.jobNotes ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                  color: "#555",
                  lineHeight: 1.45,
                }}
              >
                {invite.jobNotes}
              </pre>
            ) : null}
          </Card>
          <h2 style={sectionTitle}>Your contact info</h2>
          <Card>
            <form onSubmit={continueToTime}>
              <Input label="Name *" value={displayName} onChange={setDisplayName} />
              <Input label="Address *" value={address} onChange={setAddress} />
              <Input label="Phone *" type="tel" value={phone} onChange={setPhone} />
              <Input
                label="Anything to add? (optional)"
                value={notes}
                onChange={setNotes}
                placeholder="Access, parking, updates since Thumbtack…"
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

      {!doneMessage && step === "time" && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700 }}>{invite.jobTitle}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{address}</div>
          </Card>
          <h2 style={sectionTitle}>Pick your time</h2>
          {selectedRange && !rangeAnchor ? (
            <Card style={{ marginBottom: 14, background: colors.accentSoft, border: `2px solid ${colors.accent}` }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{formatRange(selectedRange.start, selectedRange.end)}</div>
              <Btn onClick={goToSubmit}>Review & confirm →</Btn>
            </Card>
          ) : null}
          {byDay.length === 0 ? (
            <Card><p style={{ margin: 0, color: colors.mmuted }}>No open times right now.</p></Card>
          ) : (
            byDay.map(([day, runs]) => {
              const open = openDayKey === day;
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
                    style={{
                      width: "100%",
                      textAlign: "left",
                      fontWeight: 700,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 15,
                      marginBottom: open ? 12 : 0,
                    }}
                  >
                    {label} {open ? "▲" : "▼"}
                  </button>
                  {open ? runs.map((run, ri) => (
                    <div
                      key={ri}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      {run.map((slot) => {
                        const key = slotKey(slot);
                        const inRange = selectedSlotKeys.has(key);
                        const picked = rangeAnchor && sameSlot(rangeAnchor, slot);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => onSlotClick(slot)}
                            style={{
                              padding: "12px 14px",
                              borderRadius: 8,
                              border: picked || inRange ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
                              background: picked || inRange ? colors.accentSoft : "#fff",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              fontSize: 14,
                            }}
                          >
                            {formatSlotLabel(slot)}
                          </button>
                        );
                      })}
                    </div>
                  )) : null}
                </Card>
              );
            })
          )}
          {formError && <p style={{ color: colors.danger, fontSize: 13 }}>{formError}</p>}
          <button
            type="button"
            onClick={() => setStep("setup")}
            style={{
              background: "transparent",
              border: "none",
              color: colors.text,
              textDecoration: "underline",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            ← Back to your info
          </button>
        </>
      )}

      {!doneMessage && step === "submit" && selectedRange && (
        <>
          <h2 style={sectionTitle}>Review & submit</h2>
          <Card>
            <form onSubmit={submit}>
              <dl style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.6 }}>
                <dt style={{ fontWeight: 600 }}>Job</dt>
                <dd style={{ margin: "0 0 12px" }}>{invite.jobTitle}</dd>
                <dt style={{ fontWeight: 600 }}>When</dt>
                <dd style={{ margin: "0 0 12px" }}>{formatRange(selectedRange.start, selectedRange.end)}</dd>
                <dt style={{ fontWeight: 600 }}>Contact</dt>
                <dd style={{ margin: "0 0 12px" }}>
                  {displayName}<br />{address}<br />{phone}
                </dd>
              </dl>
              {formError && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.danger }} role="alert">
                  {formError}
                </p>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Btn type="submit" disabled={submitting}>
                  {submitting ? "Sending…" : "Submit request"}
                </Btn>
                <Btn type="button" color="#7f8c8d" onClick={() => setStep("time")}>Change time</Btn>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
