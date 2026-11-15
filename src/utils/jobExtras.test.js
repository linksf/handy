import { expect, test } from "vitest";
import { applyOrder, partReminder, postponeForPart } from "./jobExtras";
import { buildJobInvoiceLines, invoiceTotalFromLines } from "../../shared/invoices.js";

test("approval adds the exact change to its invoice once and keeps prior issuance intact", () => {
  const original = [{ id: "version-1", total: 250 }];
  const job = { price: 250, invoices: [{ id: "final", name: "Final" }],
    changeOrders: [{ id: "order", title: "Wall repair", amountCents: 12500 }], issuedInvoices: { primary: original } };
  const approval = { approvedBy: "Jordan", invoiceId: "final" };
  const updated = { ...job, ...applyOrder(job, "order", approval) };
  expect(invoiceTotalFromLines(buildJobInvoiceLines(updated, "final"))).toBe(125);
  expect(invoiceTotalFromLines(buildJobInvoiceLines(updated, "primary"))).toBe(250);
  expect(updated.issuedInvoices.primary).toEqual(original);
  expect(() => applyOrder(updated, "order", approval)).toThrow(/already/);
});

test("a hold affects only the visit that depends on the backordered part", () => {
  const assessment = { id: "first", status: "completed" };
  const job = { visits: [assessment, { id: "return", status: "scheduled", calendarEventId: "e", communicatedAt: "yesterday" }],
    parts: [{ id: "part", visitId: "return", status: "Backordered", reminderOn: "2026-11-14" }] };
  expect(postponeForPart(job, "part", "return", "Awaiting stock").visits).toEqual([
    assessment, expect.objectContaining({ status: "deferred", communicatedAt: null, syncStatus: "pending", calendarEventId: "e" }),
  ]);
  expect(partReminder(job.parts[0], "2026-11-14")).toEqual(["2026-11-14", "Follow up"]);
});
