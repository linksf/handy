import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import Card from "../ui/Card";
import Btn from "../ui/Btn";
import Input from "../ui/Input";
import Badge from "../ui/Badge";
import { formatBookingStatusMessage } from "../../utils/bookingStatus";
import { colors, pageWrap, sectionTitle, clientFont } from "./clientTheme";

function formatRequestTime(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDurationMinutes(mins) {
  const m = Number(mins) || 0;
  if (m >= 60 && m % 60 === 0) return `${m / 60} hr`;
  if (m >= 60) return `${(m / 60).toFixed(1)} hr`;
  return `${m} min`;
}

function bookingIsUpcoming(req) {
  if (req.status === "declined") return false;
  if (req.status === "pending") return true;
  return (req.requestedEnd?.toMillis?.() || 0) >= Date.now();
}

export default function ClientProfile({ user, profile, profileLoading, saveProfile }) {
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "bookingRequests"),
      where("clientUid", "==", user.uid),
      orderBy("requestedStart", "desc")
    );
    return onSnapshot(
      q,
      (snap) => setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("client bookings listener", err)
    );
  }, [user?.uid]);

  useEffect(() => {
    if (profileLoading) return;
    const dn = (profile?.displayName || "").trim();
    const ad = (profile?.address || "").trim();
    const ph = (profile?.phone || "").trim();
    setDisplayName(dn || user?.displayName || "");
    setAddress(ad);
    setPhone(ph);
  }, [profile, profileLoading, user?.displayName]);

  const { upcoming, past } = useMemo(() => {
    const up = [];
    const pa = [];
    for (const b of bookings) {
      if (bookingIsUpcoming(b)) up.push(b);
      else pa.push(b);
    }
    up.sort((a, b) => (a.requestedStart?.toMillis?.() || 0) - (b.requestedStart?.toMillis?.() || 0));
    return { upcoming: up, past: pa };
  }, [bookings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveNotice(null);
    setSaving(true);
    try {
      await saveProfile({ displayName, address, phone });
      setSaveNotice("Profile saved.");
      setTimeout(() => setSaveNotice(null), 2500);
    } catch (err) {
      console.error(err);
      setSaveNotice("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const statusStyle = (s) => {
    if (s === "pending") return { bg: "#fef9e7", tc: "#f39c12", label: "Pending" };
    if (s === "approved") return { bg: "#d5f5e3", tc: "#27ae60", label: "Approved" };
    return { bg: "#fadbd8", tc: "#c0392b", label: "Declined" };
  };

  const renderBooking = (r) => {
    const st = statusStyle(r.status);
    return (
      <li
        key={r.id}
        style={{
          padding: "14px 0",
          borderBottom: "1px solid #ecf0f1",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{r.title}</div>
          <Badge text={st.label} color={st.bg} textColor={st.tc} />
        </div>
        <div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
          {formatRequestTime(r.requestedStart)} – {formatRequestTime(r.requestedEnd)}
        </div>
        {r.requestedDurationMinutes ? (
          <div style={{ fontSize: 12, color: colors.mmuted, marginBottom: 8 }}>
            {formatDurationMinutes(r.requestedDurationMinutes)} requested
          </div>
        ) : null}
        {r.location ? (
          <div style={{ fontSize: 13, color: colors.mmuted, marginBottom: 8 }}>{r.location}</div>
        ) : null}
        <p style={{ margin: 0, fontSize: 13, color: "#555", lineHeight: 1.45 }}>
          {formatBookingStatusMessage(r)}
        </p>
      </li>
    );
  };

  return (
    <div style={{ ...pageWrap, fontFamily: clientFont }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.text }}>Your profile</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#555" }}>
          {user.displayName || user.email || " Signed in"}
        </p>
      </header>

      <Card style={{ marginBottom: 24 }}>
        <h2 style={{ ...sectionTitle, marginTop: 0 }}>Contact & location</h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#555", lineHeight: 1.5 }}>
          Saved here and prefilled when you request a booking.
        </p>
        <form onSubmit={handleSave}>
          <Input label="Name" value={displayName} onChange={setDisplayName} placeholder="Your name" autoComplete="name" />
          <Input label="Address" value={address} onChange={setAddress} placeholder="Street, city, ZIP" autoComplete="street-address" />
          <Input label="Phone" type="tel" value={phone} onChange={setPhone} placeholder="Best number to reach you" autoComplete="tel" />
          {saveNotice && (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13,
                color: saveNotice.includes("Could not") ? colors.danger : colors.success,
              }}
            >
              {saveNotice}
            </p>
          )}
          <Btn type="submit" disabled={saving || profileLoading}>
            {saving ? "Saving…" : "Save profile"}
          </Btn>
        </form>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ ...sectionTitle, margin: 0 }}>Upcoming & pending</h2>
        <a
          href="/"
          style={{ fontSize: 13, fontWeight: 600, color: "#2980b9", textDecoration: "none" }}
        >
          + New request
        </a>
      </div>
      <Card style={{ marginBottom: 20 }}>
        {upcoming.length === 0 ? (
          <p style={{ margin: 0, color: colors.mmuted, fontSize: 14 }}>
            No upcoming requests.{" "}
            <a href="/" style={{ color: "#2980b9", fontWeight: 600 }}>
              Request a time
            </a>
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{upcoming.map(renderBooking)}</ul>
        )}
      </Card>

      <h2 style={sectionTitle}>Past</h2>
      <Card>
        {past.length === 0 ? (
          <p style={{ margin: 0, color: colors.mmuted, fontSize: 14 }}>No past visits yet.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{past.map(renderBooking)}</ul>
        )}
      </Card>
    </div>
  );
}
