import { useMemo, useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import { displayDay, displayPacificTime, pacificDay, recordDate, shiftDay } from "../utils/adminDates";
import { jobCommitments } from "../utils/adminQueues";

export default function CalendarAgenda({ ctx }) {
  const { data, bookingRequests, nav } = ctx;
  const today = pacificDay(new Date());
  const [weekStart, setWeekStart] = useState(today);
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(weekStart, index));
  const agenda = useMemo(() => {
    const approved = new Map(bookingRequests.filter(row => row.status === "approved" && row.linkedJobId)
      .map(row => [row.linkedJobId, row]));
    const customersById = new Map(data.customers.map(customer => [customer.id, customer]));
    return [
      ...data.jobs.flatMap(job => jobCommitments(job, approved.get(job.id)).map(visit => ({
        ...visit, visitId: visit.key, key: `job:${job.id}:${visit.key}`, id: job.id,
        title: job.title, view: "job/:id", status: job.status, detail: customersById.get(job.customerId)?.name,
      }))),
      ...bookingRequests.filter(row => row.status === "pending").map(row => ({
        key: `booking:${row.id}`, id: row.id, view: "booking/:id", title: row.title,
        day: pacificDay(row.requestedStart), time: row.requestedStart, status: "Pending booking", detail: row.location,
      })),
    ].sort((a, b) => (recordDate(a.time)?.getTime() ?? Infinity) - (recordDate(b.time)?.getTime() ?? Infinity));
  }, [data.jobs, data.customers, bookingRequests]);

  return (
    <div>
      <header className="daily-heading">
        <h1>Calendar</h1>
        <p>Pacific time</p>
      </header>
      <div className="agenda-controls">
        <Btn onClick={() => setWeekStart(day => shiftDay(day, -7))}>Previous week</Btn>
        <Btn onClick={() => setWeekStart(today)}>Today</Btn>
        <Btn onClick={() => setWeekStart(day => shiftDay(day, 7))}>Next week</Btn>
      </div>
      <div className="agenda-days">
        {days.map(day => {
          const items = agenda.filter(item => item.day === day);
          return (
            <Card key={day} style={{ padding: 0, borderColor: day === today ? "#d79610" : undefined }}>
              <section className="queue-panel" style={{ border: 0 }} aria-labelledby={`agenda-${day}`}>
                <h2 id={`agenda-${day}`}>{displayDay(day)} {day === today && <span>Today</span>}</h2>
                {items.length ? <ul className="queue-rows">
                  {items.map(item => <li className="queue-row" key={item.key}>
                    <div className="queue-info">
                      <span className={`admin-status ${item.view === "booking/:id" ? "admin-status--decision" : ""}`}>{item.status}</span>
                      <strong>{item.title}</strong>
                      <span className="queue-meta">{[item.label, displayPacificTime(item.time), item.detail].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="admin-action-row">
                    <Btn onClick={() => nav(item.view, item.id)}>{item.view === "booking/:id" ? "Review booking" : "Open visit"}</Btn>
                    {item.visitId && <Btn onClick={() => nav("visitEditor", [item.id, item.visitId])}>Edit visit</Btn>}
                    </div>
                  </li>)}
                </ul> : <p className="queue-empty">Nothing scheduled.</p>}
              </section>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
