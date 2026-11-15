import { useEffect, useMemo, useRef, useState } from "react";
import Btn from "./ui/Btn";
import { useAdminLocalState } from "../hooks/useAdminLocalState";
import { displayDay, pacificDay, shiftDay } from "../utils/adminDates";
import { buildAdminQueues } from "../utils/adminQueues";

const sections = [
  ["today", "Today", "No confirmed visits today."],
  ["reply", "Needs reply", "No recent replies to review."],
  ["decision", "Needs a decision", "No recent decisions waiting."],
  ["money", "Money due", "No balances to review."],
  ["overdue", "Overdue", "No past-dated visits still open."],
  ["upcoming", "Upcoming", "No confirmed visits after today."],
];

function QueueRows({ rows, queue, nav, change }) {
  const triage = ["reply", "decision", "backlog"].includes(queue);
  return <ul className="queue-rows">
    {rows.map(row => (
      <li className="queue-row" key={row.key} data-queue-key={row.key}>
        <div className="queue-info">
          <span className={`admin-status admin-status--${queue}`}>{row.status}</span>
          <strong>{row.title}</strong>
          {row.detail && <span className="queue-meta">{row.detail}</span>}
        </div>
        <div className={triage ? "queue-actions queue-actions--triage" : "queue-actions"}>
          <Btn style={{ paddingInline: 12 }} onClick={() => nav(row.view, row.id)}>{row.action}</Btn>
          {triage && (
            <>
              <button className="admin-quiet" aria-label={`Defer ${row.title} until tomorrow`} onClick={event => change(row, "deferred", event.currentTarget)}>Defer</button>
              <button className="admin-quiet" aria-label={`Dismiss ${row.title}`} onClick={event => change(row, "dismissed", event.currentTarget)}>Dismiss</button>
            </>
          )}
        </div>
      </li>
    ))}
  </ul>;
}

export default function Dashboard({ ctx }) {
  const { data, nav, leads, inquiries, bookingRequests, intake } = ctx;
  const [today, setToday] = useState(() => pacificDay(new Date()));
  const [hidden, setHidden] = useAdminLocalState("queue", {});
  const [notice, setNotice] = useState(null);
  const undoButton = useRef(null);
  const lastControl = useRef(null);
  useEffect(() => {
    const update = () => setToday(pacificDay(new Date()));
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);

  const queues = useMemo(() => buildAdminQueues({ ...data, leads, inquiries, bookingRequests, intake }, today),
    [data.jobs, data.customers, leads, inquiries, bookingRequests, intake, today]);
  const isHidden = row => {
    const entry = hidden[row.key];
    return entry?.revision === row.revision && (entry.kind === "dismissed" || entry.until > today);
  };
  const hiddenRows = [...queues.reply, ...queues.decision, ...queues.backlog].filter(isHidden);
  const change = (row, kind, control) => {
    lastControl.current = { key: row.key, label: control.getAttribute("aria-label") };
    setHidden(current => ({
      ...current, [row.key]: { kind, revision: row.revision, until: shiftDay(today, 1) },
    }));
    setNotice({ key: row.key, title: row.title, kind });
  };
  useEffect(() => {
    if (notice) undoButton.current?.focus();
    else if (lastControl.current) {
      const { key, label } = lastControl.current;
      const row = [...document.querySelectorAll("[data-queue-key]")].find(item => item.dataset.queueKey === key);
      [...(row?.querySelectorAll("button") || [])].find(button => button.getAttribute("aria-label") === label)?.focus();
      lastControl.current = null;
    }
  }, [notice]);

  const restore = key => {
    if (lastControl.current?.key !== key) {
      const row = hiddenRows.find(item => item.key === key);
      lastControl.current = { key, label: row && `Dismiss ${row.title}` };
    }
    setHidden(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setNotice(null);
  };

  const backlog = queues.backlog.filter(row => !isHidden(row));
  return (
    <div className="daily-dashboard">
      <header className="daily-heading">
        <h1>Dashboard</h1>
        <p>{displayDay(today)} · Pacific time</p>
      </header>
      {notice && (
        <div className="queue-notice">
          <span role="status">{notice.title} {notice.kind === "deferred" ? "deferred until tomorrow" : "dismissed"}.</span>
          <button className="admin-quiet" ref={undoButton} onClick={() => restore(notice.key)}>Undo</button>
        </div>
      )}
      <div className="queue-grid">
        {sections.map(([key, label, empty]) => {
          const rows = queues[key].filter(row => !isHidden(row));
          const content = rows.length ? <QueueRows rows={rows} queue={key} nav={nav} change={change} />
            : <p className="queue-empty">{empty}</p>;
          return key === "upcoming"
            ? <details className="queue-panel" key={key}><summary>{label} <span>{rows.length}</span></summary>{content}</details>
            : <section className={`queue-panel queue-panel--${key}`} key={key} aria-labelledby={`queue-${key}`}>
              <h2 id={`queue-${key}`}>{label} <span>{rows.length}</span></h2>
              {content}
            </section>;
        })}
      </div>
      <details className="queue-panel queue-archive">
        <summary>Historical backlog <span>{backlog.length}</span></summary>
        <p className="queue-empty">Intake older than seven Pacific calendar days, recovered leads, and past booking requests.</p>
        {backlog.length > 0 && <QueueRows rows={backlog} queue="backlog" nav={nav} change={change} />}
      </details>
      {hiddenRows.length > 0 && <details className="queue-panel queue-archive">
        <summary>Deferred and dismissed <span>{hiddenRows.length}</span></summary>
        <ul className="queue-rows">
          {hiddenRows.map(row => <li className="queue-row" key={row.key}>
            <div className="queue-info"><strong>{row.title}</strong><span className="queue-meta">
              {hidden[row.key].kind === "dismissed" ? "Dismissed" : `Deferred until ${displayDay(hidden[row.key].until)}`}
            </span></div>
            <Btn onClick={() => restore(row.key)}>Restore</Btn>
          </li>)}
        </ul>
      </details>}
    </div>
  );
}
