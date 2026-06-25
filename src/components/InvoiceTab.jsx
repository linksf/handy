import { useMemo, useState } from "react";
import Card from "./ui/Card";
import Btn from "./ui/Btn";
import Badge from "./ui/Badge";
import { payColor } from "../constants";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "../utils/jobInvoiceLines";

function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function InvoiceTab({ job, saveJob, customer, costBreakdown }) {
  const flatRate = parseFloat(job.price) || 0;
  const hourlyRate = parseFloat(job.hourlyRate) || 0;
  const hours = parseFloat(job.hours) || 0;
  const hourlyTotal = hourlyRate * hours;
  const laborTotal = flatRate + hourlyTotal;
  const amountPaid = parseFloat(job.amountPaid) || 0;
  const [payInput, setPayInput] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [pdfNotice, setPdfNotice] = useState(null);

  const invoiceLines = useMemo(() => buildJobInvoiceLines(job), [job]);
  const invoiceTotal = useMemo(() => invoiceTotalFromLines(invoiceLines), [invoiceLines]);
  const balance = Math.max(0, invoiceTotal - amountPaid);

  const recordPayment = () => {
    const amt = parseFloat(payInput) || 0;
    const newPaid = Math.min(amountPaid + amt, invoiceTotal);
    const newStatus = newPaid >= invoiceTotal ? "Paid" : newPaid > 0 ? "Partial" : "Unpaid";
    saveJob({ amountPaid: newPaid, payStatus: newStatus });
    setPayInput("");
  };

  const handleDownloadPdf = async () => {
    setPdfError(null);
    setPdfBusy(true);
    try {
      const { generateJobInvoicePdf } = await import("../utils/generateJobInvoicePdf");
      generateJobInvoicePdf({ job, customer });
      setPdfNotice("PDF downloaded.");
      setTimeout(() => setPdfNotice(null), 2500);
    } catch (err) {
      setPdfError(err?.message || "Could not generate PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>🧾 Invoice — {job.title}</h3>

      <div
        style={{
          marginBottom: 20,
          padding: 14,
          borderRadius: 8,
          border: "1px solid #d5dbdb",
          background: "#f8f9fa",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: "#232323", marginBottom: 6 }}>
          PDF invoice
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555", lineHeight: 1.45 }}>
          Generates a PDF with labor and reimbursable items. Download it and send to your customer by text or email.
        </p>

        {invoiceLines.length > 0 ? (
          <div style={{ marginBottom: 12, fontSize: 13, color: "#555" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Invoice total {formatUsd(Math.round(invoiceTotal * 100))}
            </div>
            {invoiceLines.map((line, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                <span>{line.name}</span>
                <span>{formatUsd(line.amountCents)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "#c0392b" }}>
            Add a flat rate, hourly total, or reimbursable expense before generating an invoice.
          </p>
        )}

        <Btn onClick={handleDownloadPdf} disabled={pdfBusy || invoiceLines.length === 0}>
          {pdfBusy ? "Generating…" : "Download PDF invoice"}
        </Btn>

        {pdfNotice ? (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "#27ae60" }}>{pdfNotice}</p>
        ) : null}
        {pdfError ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#c0392b" }} role="alert">
            {pdfError}
          </p>
        ) : null}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{customer?.name}</div>
        {customer?.address && <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer.address}</div>}
        {customer?.phone && <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer.phone}</div>}
        {customer?.email && <div style={{ fontSize: 13, color: "#7f8c8d" }}>{customer.email}</div>}
      </div>

      {(job.tasks || []).length > 0 && (
        <div style={{ borderTop: "1px solid #bdc3c7", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Tasks</div>
          {job.tasks.map((t) => {
            const tc = (t.materials || []).reduce(
              (s, m) => s + (parseFloat(m.cost) || 0) * (parseFloat(m.qty) || 1),
              0
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

      {(job.expenses || []).length > 0 && (
        <div style={{ borderTop: "1px solid #bdc3c7", paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Expenses</div>
          {job.expenses.map((e) => (
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
          <span style={{ fontWeight: 600 }}>Labor total</span>
          <span style={{ color: "#2d3748", fontWeight: 700 }}>${laborTotal.toFixed(2)}</span>
        </div>
        {costBreakdown.reimbursable > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>+ Reimbursable (on invoice)</span>
            <span style={{ color: "#27ae60" }}>${costBreakdown.reimbursable.toFixed(2)}</span>
          </div>
        )}
      </div>

      <div style={{ borderTop: "2px solid #bdc3c7", paddingTop: 10, marginBottom: 12 }}>
        {costBreakdown.nonReimbursable > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#7f8c8d" }}>Non-reimbursable costs</span>
            <span style={{ color: "#7f8c8d" }}>${costBreakdown.nonReimbursable.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
          <span style={{ fontWeight: 600 }}>Your costs</span>
          <span style={{ color: "#c0392b", fontWeight: 700 }}>${costBreakdown.total.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ borderTop: "2px solid #bdc3c7", paddingTop: 10 }}>
        {[
          ["Invoice total", `$${invoiceTotal.toFixed(2)}`, "#2d3748"],
          ["Amount paid", `$${amountPaid.toFixed(2)}`, "#27ae60"],
          ["Balance due", `$${balance.toFixed(2)}`, balance > 0 ? "#c0392b" : "#27ae60"],
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
              onChange={(e) => setPayInput(e.target.value)}
              type="number"
              placeholder="Payment amount $"
              style={{ flex: 1, border: "1px solid #bdc3c7", borderRadius: 6, padding: "7px 10px", fontSize: 13 }}
            />
            <Btn onClick={recordPayment}>Record payment</Btn>
          </>
        )}
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "#7f8c8d", lineHeight: 1.45 }}>
        Record cash, check, or other payments here. The PDF reflects the current paid balance.
      </p>
    </Card>
  );
}
