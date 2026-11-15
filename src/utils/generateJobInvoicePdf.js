import { invoicePaid, jobInvoices } from "../../shared/invoices.js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BUSINESS_NAME,
  BUSINESS_SITE_URL,
  BUSINESS_TAGLINE,
  BRAND,
} from "../constants";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "./jobInvoiceLines";
import logoUrl from "../assets/Omnific_logo_bw.png";

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

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

async function loadLogoDataUrl() {
  const res = await fetch(logoUrl);
  if (!res.ok) {
    throw new Error("Could not load Omnificology logo for the invoice PDF.");
  }
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read Omnificology logo."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Build and download a PDF invoice for a job (labor + reimbursable line items).
 * Classic letterhead layout: logo + Omnificology left, INVOICE right, amber rule.
 */
export async function generateJobInvoicePdf({ job, customer, invoiceId = "primary", output = "download", snapshot }) {
  if (snapshot) {
    job = { ...job, title: snapshot.title, date: snapshot.date, notes: snapshot.notes };
    customer = snapshot.customer;
  }
  const lines = snapshot?.lines || buildJobInvoiceLines(job, invoiceId);
  const invoice = snapshot || jobInvoices(job).find(i => i.id === invoiceId);
  if (lines.length === 0) {
    throw new Error("Add a flat rate, hourly total, or reimbursable expense before generating an invoice.");
  }

  const total = invoiceTotalFromLines(lines);
  const amountPaid = snapshot?.paid ?? invoicePaid(job, invoiceId);
  const balance = Math.max(0, total - amountPaid);
  const logoDataUrl = await loadLogoDataUrl();

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const right = pageWidth - margin;
  const charcoal = hexToRgb(BRAND.charcoal);
  const amber = hexToRgb(BRAND.amber);
  const amberDark = hexToRgb(BRAND.amberDark);
  const stone = hexToRgb(BRAND.stone);
  const stoneLight = hexToRgb(BRAND.stoneLight);
  const muted = hexToRgb(BRAND.muted);

  // Logo is ~684×1025 — tall shield mark
  const logoH = 22;
  const logoW = logoH * (684 / 1025);
  const headerTop = margin;
  doc.addImage(logoDataUrl, "PNG", margin, headerTop, logoW, logoH);

  const textLeft = margin + logoW + 4;
  doc.setTextColor(...charcoal);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(BUSINESS_NAME, textLeft, headerTop + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(BUSINESS_TAGLINE, textLeft, headerTop + 12);

  doc.setTextColor(...amberDark);
  doc.setFontSize(8);
  const linkLabel = "omnificology.com";
  doc.textWithLink(linkLabel, textLeft, headerTop + 17, { url: BUSINESS_SITE_URL });

  doc.setTextColor(...charcoal);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("INVOICE", right, headerTop + 7, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  const today = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  doc.text(`Invoice #: ${shortInvoiceId(job.id) + "-" + shortInvoiceId(invoiceId)}`, right, headerTop + 13, { align: "right" });
  doc.text(today, right, headerTop + 18, { align: "right" });

  const ruleY = headerTop + logoH + 4;
  doc.setDrawColor(...amber);
  doc.setLineWidth(1.2);
  doc.line(margin, ruleY, right, ruleY);

  let y = ruleY + 10;
  doc.setTextColor(...charcoal);
  doc.setFontSize(10);

  if (snapshot?.issuedOn) {
    doc.text(`Issued: ${snapshot.issuedOn}`, margin, y);
    y += 6;
  }
  if (job.date) {
    doc.text(`Job date: ${job.date}`, margin, y);
    y += 8;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text("BILL TO", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...charcoal);

  for (const line of [customer?.name, customer?.address, customer?.phone, customer?.email].filter(Boolean)) {
    doc.text(String(line), margin, y);
    y += 5;
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(job.title || "Job", margin, y);
  y += 4;

  const notes = String(job.notes || "").trim();
  if (notes) {
    autoTable(doc, {
      startY: y + 4,
      head: [["Job notes"]],
      body: [[notes]],
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 2, textColor: charcoal, overflow: "linebreak" },
      headStyles: { fontSize: 8, fontStyle: "bold", textColor: muted },
      margin: { left: margin, right: margin, bottom: margin },
    });
    y = doc.lastAutoTable.finalY;
  }

  autoTable(doc, {
    startY: y + 4,
    head: [["Description", "Amount"]],
    body: lines.map((line) => [line.name + (line.comped ? " — Comped" : ""),
      line.comped ? `${formatUsd(line.originalAmountCents / 100)}\n$0.00` : formatUsd(line.amountCents / 100)]),
    didDrawCell: data => {
      if (data.section !== "body" || data.column.index !== 1 || !lines[data.row.index]?.comped) return;
      const original = formatUsd(lines[data.row.index].originalAmountCents / 100);
      const x = data.cell.x + data.cell.width - data.cell.padding("right");
      const y = data.cell.y + data.cell.padding("top") + doc.getFontSize() * 0.3528 * 0.38;
      doc.setDrawColor(...charcoal);
      doc.setLineWidth(0.25);
      doc.line(x - doc.getTextWidth(original), y, x, y);
    },
    theme: "plain",
    headStyles: {
      fillColor: charcoal,
      textColor: stoneLight,
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      textColor: charcoal,
      fontSize: 10,
    },
    alternateRowStyles: {
      fillColor: stoneLight,
    },
    styles: { cellPadding: 4, lineColor: stone, lineWidth: 0.2 },
    columnStyles: { 1: { halign: "right", cellWidth: 32 } },
    margin: { left: margin, right: margin },
  });

  y = doc.lastAutoTable.finalY + 10;
  // Keep the totals and payment footer together after paginated content.
  if (y + 44 > doc.internal.pageSize.getHeight() - margin) {
    doc.addPage();
    y = margin + 6;
  }
  const labelX = 130;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...charcoal);
  doc.text("Total", labelX, y);
  doc.text(formatUsd(total), right, y, { align: "right" });
  y += 6;
  doc.text("Amount paid", labelX, y);
  doc.text(formatUsd(amountPaid), right, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Balance due", labelX, y);
  doc.text(formatUsd(balance), right, y, { align: "right" });

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`Payment status: ${balance === 0 ? "Paid" : amountPaid > 0 ? "Partial" : "Unpaid"}`, margin, y);

  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(...amberDark);
  doc.textWithLink(BUSINESS_SITE_URL.replace(/^https:\/\//, ""), margin, y, {
    url: BUSINESS_SITE_URL,
  });

  if (output === "arraybuffer") return doc.output("arraybuffer");
  const filename = `invoice-${safeFilenamePart(job.title + "-" + (invoice?.name || "invoice"))}-${shortInvoiceId(job.id) + "-" + shortInvoiceId(invoiceId)}.pdf`;
  doc.save(filename);
}
