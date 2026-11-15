import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { dayOf, moneyCents } from "../../shared/finance.js";
import { pacificDay } from "../utils/adminDates";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Input from "./ui/Input";
import Select from "./ui/Select";

const dollars = cents => `$${(cents / 100).toFixed(2)}`;
const labels = { payment: "Record payment", refund: "Record refund", correction: "Correct payment date", legacy: "Date legacy payment" };

export default function InvoicePayments({ jobId, invoiceId, paid, total, initialAction, onSaved }) {
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  const [action, setAction] = useState(initialAction || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => pacificDay(new Date()));
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  const inFlight = useRef(false);
  const transactionKey = useRef(null);
  useEffect(() => onSnapshot(query(collection(db, "payments"), where("jobId", "==", jobId)),
    snapshot => {
      setRecords(snapshot.docs.map(row => ({ ...row.data(), id: row.id }))
        .filter(row => (row.invoiceId || "primary") === invoiceId)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))));
      setLoaded(true);
      setReadError("");
    }, () => setReadError("Payment history could not be loaded.")), [jobId, invoiceId]);
  const selected = records.find(row => row.id === target);
  const previousDate = selected ? dayOf(selected.date || selected.occurredAt) : null;
  const paymentCents = moneyCents(paid);
  const totalCents = moneyCents(total);
  const undated = Math.max(0, paymentCents - records.reduce((sum, row) => sum + Number(row.amountCents || 0), 0));
  const amountCents = moneyCents(amount);
  const nextPaid = paymentCents + (action === "refund" ? -amountCents : action === "payment" ? amountCents : 0);
  const valid = !!date && (action === "correction" ? !!selected && date !== previousDate && !!reason.trim()
    : /^\d+(\.\d{1,2})?$/.test(amount) && amountCents > 0 &&
      (action !== "refund" || amountCents <= paymentCents) && (action !== "legacy" || loaded && amountCents <= undated));
  const choose = value => {
    setAction(value); setReview(null); setError(""); setFeedback("");
    setAmount(""); setTarget(""); setReason(""); setDate(pacificDay(new Date()));
    transactionKey.current = null;
  };
  const submit = async () => {
    if (!valid || !review || inFlight.current) return;
    if (review.paid !== paymentCents || review.total !== totalCents || review.previousDate !== previousDate) {
      setReview(null);
      setError("The ledger changed. Review the effect again.");
      return;
    }
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      if (action === "correction") {
        await httpsCallable(functions, "correctJobPaymentDate")({ jobId, invoiceId, paymentId: selected.id, date, expectedDate: previousDate, reason });
      } else {
        transactionKey.current ??= crypto.randomUUID();
        await httpsCallable(functions, "recordJobPayment")({ jobId, invoiceId, amount, date, refund: action === "refund",
          historical: action === "legacy", idempotencyKey: transactionKey.current });
      }
      const message = `${labels[action]} saved.`;
      choose("");
      setFeedback(message);
      onSaved?.();
    } catch (err) { setError(err.message || "Could not save this transaction."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <Card>
    <section id="invoice-payments" aria-label="Payments">
      <h3 style={{ marginTop: 0 }}>Payments</h3>
      <div className="admin-action-row">
        {Object.entries(labels).map(([key, label]) => <button type="button" className="admin-quiet" key={key}
          aria-pressed={action === key} disabled={busy || (key === "refund" && paymentCents <= 0) ||
            (key === "correction" && !records.length) || (key === "legacy" && (!loaded || undated <= 0))}
          onClick={() => choose(key)}>{label}</button>)}
      </div>
      {readError && <p role="alert">{readError}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {action && <>
        <h4>{labels[action]}</h4>
        {action === "refund" && <p>Record a refund that already happened. This action updates Handy’s ledger.</p>}
        {action === "legacy" && <p>{dollars(undated)} of prior payments can be dated. The invoice balance stays the same.</p>}
        {action === "correction" ? <>
          <Select label="Payment to correct" value={target} onChange={value => { setTarget(value); setReview(null); }}
            options={[{ value: "", label: "Choose a payment" }, ...records.map(row => ({ value: row.id,
              label: `${dollars(row.amountCents)} · ${dayOf(row.date || row.occurredAt) || "Undated"} · ${row.id.slice(0, 6)}` }))]} />
          <Input label="Correction reason" value={reason} onChange={value => { setReason(value); setReview(null); }} />
        </> : <Input label="Amount ($)" type="number" value={amount} onChange={value => { setAmount(value); setReview(null); }} />}
        <Input label={action === "correction" ? "Corrected date" : "Payment date"} type="date" value={date}
          onChange={value => { setDate(value); setReview(null); }} />
        {review && valid && <div className="billing-review" role="status">
          {action === "correction" ? <p>Report date {previousDate || "undated"} → {date}. Amount and balance stay the same.</p>
            : <p>Paid {dollars(paymentCents)} → {dollars(nextPaid)} · Balance {dollars(Math.max(0, totalCents - paymentCents))}
              {" → "}{dollars(Math.max(0, totalCents - nextPaid))} · Report date {date}</p>}
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="admin-action-row">
          {review ? <Btn disabled={!valid || busy} onClick={submit}>{busy ? "Saving…" : "Confirm ledger change"}</Btn>
            : <Btn disabled={!valid || busy} onClick={() => setReview({ paid: paymentCents, total: totalCents, previousDate })}>Review effect</Btn>}
          <Btn color="#67757d" disabled={busy} onClick={() => choose("")}>Cancel</Btn>
        </div>
      </>}
      {records.length > 0 && <details><summary>Payment history</summary><ul>{records.map(row => <li key={row.id}>
        {dollars(row.amountCents)} · {dayOf(row.date || row.occurredAt) || "Undated"}{row.historical ? " · Legacy payment" : ""}
        {(row.dateCorrections || []).map((entry, index) => <p key={index}>{entry.previousDate || "Undated"} → {entry.date} · {entry.reason}</p>)}
      </li>)}</ul></details>}
    </section>
  </Card>;
}
