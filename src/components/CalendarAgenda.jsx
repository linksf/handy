import { useMemo, useState } from "react";
import Card from "./ui/Card";
import Badge from "./ui/Badge";
import Btn from "./ui/Btn";
import { statusColor } from "../constants";

function formatTs(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function dayKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayLabel(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function CalendarAgenda({ ctx }) {
  const { data, bookingRequests, nav, getCustomer } = ctx;
  const [weekStart, setWeekStart] = useState(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const itemsByDay = useMemo(() => {
    const map = new Map();
    for (const d of days) {
      map.set(dayKeyFromDate(d), { jobs: [], bookings: [] });
    }

    for (const j of data.jobs) {
      if (j.status === "Cancelled") continue;
      const k = j.date;
      if (map.has(k)) map.get(k).jobs.push(j);
    }

    for (const r of bookingRequests) {
      if (r.status !== "pending") continue;
      const start = r.requestedStart?.toDate?.();
      if (!start) continue;
      const k = dayKeyFromDate(start);
      if (map.has(k)) map.get(k).bookings.push(r);
    }

    for (const [, bucket] of map) {
      bucket.jobs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      bucket.bookings.sort(
        (a, b) => (a.requestedStart?.toMillis?.() || 0) - (b.requestedStart?.toMillis?.() || 0)
      );
    }

    return map;
  }, [days, data.jobs, bookingRequests]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, color: "#232323", fontWeight: 700 }}>Calendar</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small onClick={() => setWeekStart((w) => addDays(w, -7))}>← Prev</Btn>
          <Btn small onClick={() => {
            const t = new Date();
            t.setHours(0, 0, 0, 0);
            setWeekStart(t);
          }}>Today</Btn>
          <Btn small onClick={() => setWeekStart((w) => addDays(w, 7))}>Next →</Btn>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {days.map((d) => {
          const k = dayKeyFromDate(d);
          const { jobs, bookings } = itemsByDay.get(k) || { jobs: [], bookings: [] };
          const isToday = dayKeyFromDate(new Date()) === k;
          const empty = jobs.length === 0 && bookings.length === 0;

          return (
            <Card
              key={k}
              style={{
                border: isToday ? "2px solid #f9bf3b" : undefined,
                background: isToday ? "#fffef5" : undefined,
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontSize: 15, color: "#232323" }}>
                {dayLabel(d)}
                {isToday ? <span style={{ marginLeft: 8, fontSize: 12, color: "#f39c12" }}>Today</span> : null}
              </h3>
              {empty ? (
                <p style={{ margin: 0, fontSize: 13, color: "#7f8c8d" }}>Nothing scheduled.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {bookings.map((r) => (
                    <div
                      key={`b-${r.id}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 0",
                        borderBottom: "1px solid #ecf0f1",
                        cursor: r.linkedJobId ? "pointer" : "default",
                      }}
                      onClick={() => r.linkedJobId && nav("job/:id", r.linkedJobId)}
                    >
                      <div>
                        <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 2 }}>Booking request</div>
                        <div style={{ fontWeight: 600 }}>{r.title}</div>
                        <div style={{ fontSize: 12, color: "#555" }}>
                          {formatTs(r.requestedStart)} – {formatTs(r.requestedEnd)}
                        </div>
                      </div>
                      <Badge
                        text={r.status}
                        color={r.status === "pending" ? "#fef9e7" : r.status === "approved" ? "#d5f5e3" : "#fadbd8"}
                        textColor={r.status === "pending" ? "#f39c12" : r.status === "approved" ? "#27ae60" : "#c0392b"}
                      />
                    </div>
                  ))}
                  {jobs.map((j) => {
                    const c = getCustomer(j.customerId);
                    const st = statusColor[j.status] || { bg: "#ecf0f1", tc: "#232323" };
                    return (
                      <div
                        key={`j-${j.id}`}
                        onClick={() => nav("job/:id", j.id)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 0",
                          borderBottom: "1px solid #ecf0f1",
                          cursor: "pointer",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 2 }}>Job</div>
                          <div style={{ fontWeight: 600 }}>{j.title}</div>
                          <div style={{ fontSize: 12, color: "#555" }}>{c?.name || "—"}</div>
                        </div>
                        <Badge text={j.status} color={st.bg} textColor={st.tc} />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
