import { useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Badge from "./ui/Badge";
import { payColor } from "../constants";

export default function InvoiceTab({ job, saveJob, customer, costBreakdown, jobRevenue }) {
  const flatRate = parseFloat(job.price) || 0;
  const hourlyRate = parseFloat(job.hourlyRate) || 0;
  const hours = parseFloat(job.hours) || 0;
  const hourlyTotal = hourlyRate * hours;
  const price = flatRate + hourlyTotal;
  const amountPaid = parseFloat(job.amountPaid) || 0;
  const balance = price - amountPaid;
  const [payInput, setPayInput] = useState("");

  const recordPayment = () => {
    const amt = parseFloat(payInput) || 0;
    const newPaid = Math.min(amountPaid + amt, price);
    const newStatus = newPaid >= price ? "Paid" : newPaid > 0 ? "Partial" : "Unpaid";
    saveJob({ amountPaid: newPaid, payStatus: newStatus });
    setPayInput("");
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>🧾 Invoice — {job.title}</h3>

      {/* Customer info */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{customer?.name}</div>
        {customer?.address && <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer.address}</div>}
        {customer?.phone && <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer.phone}</div>}
      </div>

      {/* Tasks / materials */}
      {(job.tasks || []).length > 0 && (
        <div style={{ borderTop: "1px solid #bdc3c7", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Tasks</div>
          {job.tasks.map(t => {
            const tc = (t.materials || []).reduce(
              (s, m) => s + (parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1), 0
            );
            return (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #ecf0f1" }}>
                <span>{t.name}</span>
                <span style={{ color: "#7f8c8d" }}>materials: ${tc.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Expenses */}
      {(job.expenses || []).length > 0 && (
        <div style={{ borderTop: "1px solid #bdc3c7", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Expenses</div>
          {job.expenses.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #ecf0f1" }}>
              <span>
                {e.name}
                {e.type && <span style={{ color: "#a0aec0" }}> · {e.type}</span>}
                {e.reimbursable && <span style={{ marginLeft: 6, background: "#d5f5e3", color: "#27ae60", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 600 }}>Reimb.</span>}
              </span>
              <span style={{ color: "#7f8c8d" }}>${(parseFloat(e.amount) || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Revenue */}
      <div style={{ borderTop: "2px solid #bdc3c7", paddingTop: 10, marginBottom: 12 }}>
        {flatRate > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>Flat Rate</span>
            <span style={{ color: "#7f8c8d" }}>${flatRate.toFixed(2)}</span>
          </div>
        )}
        {hourlyTotal > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>Hourly ({hours} hrs × ${hourlyRate.toFixed(2)})</span>
            <span style={{ color: "#7f8c8d" }}>${hourlyTotal.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>Total Revenue</span>
          <span style={{ color: "#2d3748", fontWeight: 700 }}>${price.toFixed(2)}</span>
        </div>
      </div>

      {/* Cost breakdown */}
      <div style={{ borderTop: "2px solid #bdc3c7", paddingTop: 10, marginBottom: 12 }}>
        {costBreakdown.nonReimbursable > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>Non-reimbursable costs</span>
            <span style={{ color: "#7f8c8d" }}>${costBreakdown.nonReimbursable.toFixed(2)}</span>
          </div>
        )}
        {costBreakdown.reimbursable > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>Reimbursable costs</span>
            <span style={{ color: "#27ae60" }}>${costBreakdown.reimbursable.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>Total Costs</span>
          <span style={{ color: "#c0392b", fontWeight: 700 }}>${costBreakdown.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Payment */}
      <div style={{ borderTop: "2px solid #bdc3c7", paddingTop: 10 }}>
        {[
          ["Amount Paid", `$${amountPaid.toFixed(2)}`, "#27ae60"],
          ["Balance Due", `$${balance.toFixed(2)}`, balance > 0 ? "#c0392b" : "#27ae60"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{l}</span>
            <span style={{ color: c, fontWeight: 700 }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <Badge text={job.payStatus} {...payColor[job.payStatus]} />
        {job.payStatus !== "Paid" && (
          <>
            <input
              value={payInput}
              onChange={e => setPayInput(e.target.value)}
              type="number"
              placeholder="Payment amount $"
              style={{ flex: 1, border: "1px solid #bdc3c7", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
            />
            <Btn onClick={recordPayment}>Record Payment</Btn>
          </>
        )}
      </div>
    </Card>
  );
}
