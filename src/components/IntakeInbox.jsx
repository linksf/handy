import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { intakeGroups } from "../utils/intake";
import { displayDay, pacificDay, recordDate, shiftDay } from "../utils/adminDates";
import Btn from "./ui/Btn";
import Card from "./ui/Card";

function useConversation(id) {
  const [conversation, setConversation] = useState({});
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    let stopEvents = () => {};
    let activeThread;
    const failed = () => setError("Conversation could not be loaded. Reload to retry.");
    const stop = onSnapshot(query(collection(db, "thumbtackConversations"), where("leadId", "==", id)), snapshot => {
      const thread = snapshot.docs[0];
      setConversation(thread?.data() || {});
      if (thread?.id === activeThread) return;
      stopEvents();
      activeThread = thread?.id;
      setMessages([]);
      if (thread) stopEvents = onSnapshot(collection(db, "thumbtackConversations", thread.id, "events"), events => {
        setMessages(events.docs.map(event => ({ ...event.data(), eventId: event.id }))
          .filter(event => event.kind === "message" && event.source !== "owner_clarification")
          .sort((a, b) => (recordDate(b.sentAt)?.getTime() || 0) - (recordDate(a.sentAt)?.getTime() || 0)));
      }, failed);
    }, failed);
    return () => { stop(); stopEvents(); };
  }, [id]);
  return { conversation, messages, error };
}

function IntakeHistory({ source }) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => onSnapshot(collection(db, "adminIntake", source.key, "history"), snapshot =>
    setEvents(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((a, b) =>
      (recordDate(b.at)?.getTime() || 0) - (recordDate(a.at)?.getTime() || 0))), () => setError(true)), [source.key]);
  return error ? <p role="alert">History could not be loaded.</p> : events.length
    ? <ul>{events.map(event => <li key={event.id}><strong>{event.type}</strong> · {displayDay(pacificDay(event.at))}
      {event.reason && <p>{event.reason}</p>}
      {event.previousCustomerId && event.previousCustomerId !== event.customerId && <p>Previous customer ID {event.previousCustomerId}</p>}
      {event.text && <p className="intake-message">{event.text}</p>}
    </li>)}</ul> : <p>No recorded changes.</p>;
}

function SourceDetail({ source, ctx }) {
  const { conversation, messages, error } = useConversation(source.kind === "lead" ? source.id : null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState(null);
  const [snooze, setSnooze] = useState(() => shiftDay(pacificDay(new Date()), 1));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const latest = messages[0];
  const reply = draft ?? source.state.draft ?? conversation.initialResponse?.text ?? "";
  const alternates = conversation.initialResponseOpenAI;
  const persist = async (changes, event, confirmation, evidence) => {
    setBusy(true);
    setFailure("");
    setStatus("");
    try {
      await ctx.applyIntake(source.key, changes, event, evidence);
      setStatus(confirmation);
    } catch (err) {
      setFailure(err.message || "Could not save changes.");
    } finally { setBusy(false); }
  };
  const copy = async () => {
    setFailure("");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(reply);
      else {
        const field = document.getElementById("intake-reply");
        field.focus();
        field.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
      }
      setStatus("Reply copied.");
    } catch { setFailure("Copy failed. Select the text and copy it manually."); }
  };
  return <div className="intake-detail">
    <button type="button" className="admin-quiet" onClick={() => ctx.nav("inbox")}>All intake</button>
    <header className="daily-heading"><h1>{source.name || source.title}</h1><p>{source.label} · {source.group}</p></header>
    {(error || failure) && <p role="alert">{failure || error}</p>}
    <p role="status" hidden={!status}>{status}</p>
    <Card>
      <h2>Latest message</h2>
      {latest && <p className="queue-meta">{latest.sender} · {displayDay(pacificDay(latest.sentAt))}</p>}
      <p className="intake-message">{latest?.text || source.description || "No message captured."}</p>
      <label className="intake-field" htmlFor="intake-reply">Reply draft</label>
      <textarea id="intake-reply" value={reply} onChange={event => setDraft(event.target.value)} rows={5} />
      <div className="admin-action-row">
        <Btn disabled={!reply.trim()} onClick={copy}>Copy reply</Btn>
        <Btn disabled={busy || draft === null || draft === source.state.draft}
          onClick={() => persist({ draft: reply }, "save draft", "Draft saved.")}>Save draft</Btn>
        <Btn disabled={busy || !reply.trim()} onClick={() => {
          if (window.confirm("Record that you already sent this reply?")) {
            persist({ group: "Waiting", draft: reply, snoozeUntil: null, handledMessage: latest?.eventId || null, acknowledgedEvidence: source.evidence },
              "mark sent", "Reply recorded as sent.", { text: reply });
          }
        }}>Mark sent</Btn>
      </div>
      {source.state.draft && source.state.group === "Waiting" && <p className="queue-meta">A reply has been marked sent.</p>}
      {alternates?.text && <details><summary>Alternate draft</summary><p className="intake-message">{alternates.text}</p></details>}
      {messages.length > 1 && <details><summary>Earlier messages</summary>{messages.slice(1).map(message =>
        <p key={message.eventId} className="intake-message"><strong>{message.sender}</strong> · {message.text}</p>)}</details>}
    </Card>
    <Card>
      <h2>{source.title}</h2>
      <p>{[source.address, source.email, source.phone].filter(Boolean).join(" · ")}</p>
      <div className="admin-action-row">
        <Btn onClick={() => ctx.nav("newJob", { source: source.key })}>
          {source.state.jobId ? "Review job link" : "Create or link job"}
        </Btn>
        {source.jobId && <>
          <Btn onClick={() => ctx.nav("job/:id", source.jobId)}>Open job</Btn>
          <Btn onClick={() => ctx.nav("visitEditor", [source.jobId, "new"])}>Schedule visit</Btn>
        </>}
        <Btn disabled={busy} onClick={() => persist({ group: source.group === "Resolved" ? "Next reply" : "Resolved",
          snoozeUntil: null, handledMessage: latest?.eventId || null, acknowledgedEvidence: source.evidence }, "change state", source.group === "Resolved" ? "Reopened." : "Resolved.")}>
          {source.group === "Resolved" ? "Reopen" : "Resolve"}
        </Btn>
      </div>
      <div className="intake-snooze">
        <label className="intake-field">Snooze through <input type="date" value={snooze} onChange={event => setSnooze(event.target.value)} /></label>
        <Btn disabled={busy || !snooze || snooze < pacificDay(new Date())} onClick={() =>
          persist({ snoozeUntil: shiftDay(snooze, 1) }, "snooze", `Snoozed through ${displayDay(snooze)}.`)}>Snooze</Btn>
        {source.group === "Snoozed" && <Btn disabled={busy} onClick={() => persist({ snoozeUntil: null }, "unsnooze", "Snooze cleared.")}>Unsnooze</Btn>}
      </div>
      <label className="intake-field">Queue status <select value={source.group} disabled={busy}
        onChange={event => persist({ group: event.target.value, snoozeUntil: null, handledMessage: latest?.eventId || null, acknowledgedEvidence: source.evidence },
          "change state", "Queue status saved.")}>
        {intakeGroups.filter(group => group !== "Snoozed" || source.group === group).map(group => <option key={group}>{group}</option>)}
      </select></label>
      <button type="button" className="admin-quiet" onClick={() => ctx.nav(
        { lead: "leadRecord", inquiry: "inquiryRecord", job: "job/:id" }[source.kind], source.id)}>View source record</button>
      <details onToggle={event => setShowHistory(event.currentTarget.open)}>
        <summary>Intake history</summary>
        {showHistory && <IntakeHistory source={source} />}
      </details>
    </Card>
  </div>;
}

export default function IntakeInbox({ ctx }) {
  const source = ctx.intakeRows.find(row => row.key === ctx.viewParam);
  const [filter, setFilter] = useState("Open");
  if (ctx.viewParam) return source ? <SourceDetail source={source} ctx={ctx} /> : <p role="status">Loading intake record…</p>;
  const groups = filter === "Open" ? intakeGroups.slice(0, 4) : [filter];
  return <>
    <header className="daily-heading"><h1>Inbox</h1></header>
    <div className="admin-action-row intake-filter" role="group" aria-label="Filter inbox">
      {["Open", "Snoozed", "Resolved"].map(value => <button type="button" key={value} className="admin-quiet"
        aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}
    </div>
    <div className="queue-grid">
      {groups.map(group => {
        const rows = ctx.intakeRows.filter(row => row.group === group);
        return <section className="queue-panel" key={group}>
          <h2>{group} <span>{rows.length}</span></h2>
          {rows.length ? <ul className="queue-rows">{rows.map(row => <li key={row.key} className="queue-row">
            <div className="queue-info"><span className="admin-status">{row.label}</span>
              <strong>{row.name || row.title}</strong>
              <span className="queue-meta">{[row.name && row.title, row.address, displayDay(pacificDay(row.createdAt))].filter(Boolean).join(" · ")}</span>
            </div>
            <Btn onClick={() => ctx.nav("intake/:id", row.key)}>Open</Btn>
          </li>)}</ul> : <p className="queue-empty">No items.</p>}
        </section>;
      })}
    </div>
    <div className="admin-action-row" style={{ marginTop: 14 }}>
      <button className="admin-quiet" onClick={() => ctx.nav("leads")}>Thumbtack records</button>
      <button className="admin-quiet" onClick={() => ctx.nav("inquiries")}>Guest inquiry records</button>
    </div>
  </>;
}
