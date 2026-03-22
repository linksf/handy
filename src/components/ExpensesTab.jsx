import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import { uid } from "../utils";
import { useMobile } from "../hooks/useMobile";

const EXPENSE_TYPES = ["Transportation", "Referral Fee", "Subcontractor", "Permit", "Dump Fee", "Equipment Rental", "Other"];

const empty = { type: "", name: "", amount: "", datePaid: "", reimbursable: false };

export default function ExpensesTab({ job, saveJob }) {
  const isMobile = useMobile();
  const [form, setForm] = useState(empty);
  const f = (k) => (v) => setForm(x => ({ ...x, [k]: v }));

  const addExpense = () => {
    if (!form.name.trim() || !form.amount) return;
    saveJob({ expenses: [...(job.expenses || []), { id: uid(), ...form }] });
    setForm(empty);
  };

  const removeExpense = (id) =>
    saveJob({ expenses: job.expenses.filter(e => e.id !== id) });

  const expenses = job.expenses || [];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Add Expense</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Type</div>
            <select
              value={form.type}
              onChange={e => f("type")(e.target.value)}
              style={{ width: "100%", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14, background: "#fff" }}
            >
              <option value="">-- Select Type --</option>
              {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Name *</div>
            <input
              value={form.name}
              onChange={e => f("name")(e.target.value)}
              placeholder="e.g. Gas to job site"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Amount ($) *</div>
            <input
              value={form.amount}
              onChange={e => f("amount")(e.target.value)}
              type="number"
              placeholder="0.00"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#7f8c8d" }}>Date Paid</div>
            <input
              value={form.datePaid}
              onChange={e => f("datePaid")(e.target.value)}
              type="date"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #bdc3c7", borderRadius: 6, padding: "8px 10px", fontSize: 14 }}
            />
          </div>
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
          <Btn onClick={addExpense}>Add Expense</Btn>
        </div>
      </Card>

      {expenses.length === 0 ? (
        <Card><p style={{ color: "#a0aec0", textAlign: "center", margin: 0 }}>No expenses recorded yet.</p></Card>
      ) : (
        expenses.map(e => (
          <Card key={e.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
                <Btn small danger onClick={() => removeExpense(e.id)}>Remove</Btn>
              </div>
            </div>
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
