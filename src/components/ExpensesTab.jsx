import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useState } from "react";
import { pacificDay } from "../utils/adminDates";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import { uid } from "../utils";
import { useMobile } from "../hooks/useMobile";

const EXPENSE_TYPES = ["Transportation", "Referral Fee", "Subcontractor", "Permit", "Dump Fee", "Equipment Rental", "Other"];

const empty = () => ({ type: "Other", name: "", amount: "", datePaid: pacificDay(new Date()), reimbursable: false });

export default function ExpensesTab({ job, saveJob }) {
  const isMobile = useMobile();
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [editDates, setEditDates] = useState({});
  const [feedback, setFeedback] = useState("");
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));

  const valid = Number(form.amount) > 0 && !!form.datePaid;
  const addExpense = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setFeedback("");
    try {
      await saveJob({ expenses: [...(job.expenses || []), { ...form, id: uid(), name: form.name.trim() || form.type }] });
      setForm(empty());
      setFeedback("Expense saved.");
    } catch { setFeedback("Could not save expense. Your entry is still here."); }
    finally { setBusy(false); }
  };

  const removeExpense = async id => {
    try { await saveJob({ expenses: job.expenses.filter(e => e.id !== id || e.leadCostLeadId) }); }
    catch { setFeedback("Could not remove expense."); }
  };

  const expenses = job.expenses || [];

  return (
    <div>
      <p>Managed Thumbtack fees are edited on the linked lead. They are counted once in reports.</p>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Add Expense</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <Input label="Amount ($)" type="number" value={form.amount} onChange={f("amount")} placeholder="0.00" />
          <Select label="Category" value={form.type} onChange={f("type")} options={EXPENSE_TYPES} />
          <Input label="Name (optional)" value={form.name} onChange={f("name")} />
          <Input label="Date paid" type="date" value={form.datePaid} onChange={f("datePaid")} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={form.reimbursable}
            onChange={e => f("reimbursable")(e.target.checked)}
            style={{ width: 15, height: 15 }}
          />
          Reimbursable by customer
        </label>
        <div style={{ marginTop: 12 }}>
          <Btn disabled={!valid || busy} onClick={addExpense}>{busy ? "Saving…" : "Save expense"}</Btn>
          {feedback && <p role="status">{feedback}</p>}
        </div>
      </Card>

      {expenses.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center", margin: 0 }}>No expenses recorded yet.</p></Card>
      ) : (
        expenses.map((e, index) => (
          <Card key={e.id} style={{ marginBottom: 8 }}>
            <div id={`expense-cost-${e.id || index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: "#7f8c8d", marginTop: 2 }}>
                  {e.type && <span>{e.type} · </span>}
                  {e.datePaid && <span>Paid {e.datePaid} · </span>}
                  <span style={{
                    background: e.reimbursable ? "#d5f5e3" : "#bdc3c7",
                    color: e.reimbursable ? "#27ae60" : "#7f8c8d",
                    borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 600,
                  }}>
                    {e.reimbursable ? "Reimbursable" : "Non-reimbursable"}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 700 }}>${(parseFloat(e.amount) || 0).toFixed(2)}</span>
                {!e.leadCostLeadId && e.id !== "thumbtack-lead-fee" && <Btn small danger onClick={() => removeExpense(e.id)}>Remove</Btn>}
              </div>
            </div>
            {e.receiptId && <button type="button" className="admin-quiet" onClick={async () => {
              try {
                const record = (await getDoc(doc(db, "adminReceipts", e.receiptId))).data();
                if (!record) throw new Error("Receipt unavailable.");
                setReceipt({ ...record, expense: index });
              } catch { setFeedback("Could not open the receipt."); }
            }}>View receipt</button>}
            {receipt?.expense === index && <div className="billing-review">
              <p>{receipt.merchant} · {receipt.date} · ${(receipt.totalCents / 100).toFixed(2)} receipt total</p>
              {receipt.photo?.startsWith("data:image/jpeg;base64,") && <img className="change-photo" src={receipt.photo} alt="Saved receipt" />}
              <Btn onClick={() => setReceipt(null)}>Close receipt</Btn>
            </div>}
            {!e.leadCostLeadId && e.id !== "thumbtack-lead-fee" && <details open={!e.datePaid || undefined}>
              <summary>{e.datePaid ? "Correct expense date" : "Add missing expense date"}</summary>
              <Input label={`Date for ${e.name}`} type="date" value={editDates[index] ?? e.datePaid ?? ""} onChange={value => setEditDates(previous => ({ ...previous, [index]: value }))} />
              <Btn disabled={!editDates[index] || busy} onClick={async () => {
                setBusy(true);
                try {
                  await saveJob({ expenses: expenses.map((row, rowIndex) => rowIndex === index ? { ...row, datePaid: editDates[index] } : row) });
                  setFeedback("Expense date saved.");
                } catch { setFeedback("Could not save expense date."); }
                finally { setBusy(false); }
              }}>Save expense date</Btn>
            </details>}
          </Card>
        ))
      )}

      {expenses.length > 0 && (
        <Card style={{ marginTop: 8, background: "#f7fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: "#7f8c8d" }}>Non-reimbursable</span>
            <span style={{ fontWeight: 600 }}>${expenses.filter(e => !e.reimbursable).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: "#7f8c8d" }}>Reimbursable</span>
            <span style={{ fontWeight: 600 }}>${expenses.filter(e => e.reimbursable).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, borderTop: "1px solid #bdc3c7", paddingTop: 6, marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>Total Expenses</span>
            <span style={{ fontWeight: 700 }}>${expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0).toFixed(2)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
