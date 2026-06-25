import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { BUSINESS_NAME } from "../constants";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "./jobInvoiceLines";

function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

function shortInvoiceId(jobId) {
  return (jobId || "draft").slice(0, 8).toUpperCase();
}

function safeFilenamePart(value) {
  return String(value || "invoice")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

/**
 * Build and download a PDF invoice for a job (labor + reimbursable line items).
 */
export function generateJobInvoicePdf({ job, customer }) {
  const lines = buildJobInvoiceLines(job);
  if (lines.length === 0) {
    throw new Error("Add a flat rate, hourly total, or reimbursable expense before generating an invoice.");
  }

  const total = invoiceTotalFromLines(lines);
  const amountPaid = parseFloat(job.amountPaid) || 0;
  const balance = Math.max(0, total - amountPaid);

  const doc = new jsPDF();
  const margin = 14;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(BUSINESS_NAME, margin, y);
  doc.setFontSize(18);
  doc.text("INVOICE", 196, y, { align: "right" });

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const today = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  doc.text(`Date: ${today}`, margin, y);
  doc.text(`Invoice #: ${shortInvoiceId(job.id)}`, 196, y, { align: "right" });

  if (job.date) {
    y += 6;
    doc.text(`Job date: ${job.date}`, margin, y);
  }

  y += 12;
  doc.setFont("helvetica", "bold");
  doc.text("Bill to", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");

  for (const line of [customer?.name, customer?.address, customer?.phone, customer?.email].filter(Boolean)) {
    doc.text(line, margin, y);
    y += 5;
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(job.title || "Job", margin, y);
  y += 4;

  autoTable(doc, {
    startY: y + 4,
    head: [["Description", "Amount"]],
    body: lines.map((line) => [line.name, formatUsd(line.amountCents / 100)]),
    theme: "striped",
    headStyles: { fillColor: [249, 191, 59], textColor: [35, 35, 35] },
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 1: { halign: "right", cellWidth: 32 } },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 10;
  const labelX = 130;

  doc.setFont("helvetica", "normal");
  doc.text("Total", labelX, y);
  doc.text(formatUsd(total), 196, y, { align: "right" });
  y += 6;
  doc.text("Amount paid", labelX, y);
  doc.text(formatUsd(amountPaid), 196, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Balance due", labelX, y);
  doc.text(formatUsd(balance), 196, y, { align: "right" });

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Payment status: ${job.payStatus || "Unpaid"}`, margin, y);
  doc.setTextColor(0);

  const filename = `invoice-${safeFilenamePart(job.title)}-${shortInvoiceId(job.id)}.pdf`;
  doc.save(filename);
}
