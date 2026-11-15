import { expect, test } from "vitest";
import { pacificDay, shiftDay } from "./adminDates";
import { buildAdminQueues } from "./adminQueues";

test("separates Pacific visits from pending requests, completed visits, and older intake", () => {
  const today = pacificDay("2026-11-02T07:59:00Z");
  expect(today).toBe("2026-11-01");
  expect(pacificDay("2026-11-02T08:00:00Z")).toBe(shiftDay(today, 1));
  expect(pacificDay("2026-11-01")).toBe(today);
  const jobs = [
    { id: "today", status: "Scheduled", date: "2026-11-02", visits: [{ id: "v", status: "scheduled", start: "2026-11-02T07:30:00Z" }] },
    { id: "past", status: "In Progress", date: "2026-10-31" },
    { id: "future", status: "Scheduled", date: "2026-11-02" },
    { id: "cancelled", status: "Scheduled", date: "2026-11-01",
      visits: [{ status: "cancelled", start: "2026-11-01T17:30:00Z" }, {status: "completed", start: "2026-11-01T18:30:00Z"}] },
    { id: "linked", status: "Draft", source: "thumbtack", createdAt: today, sourceThumbtackLeadId: "old" },
  ];
  const leads = [
    { id: "new", status: "active", createdAt: today },
    { id: "old", status: "active", createdAt: today, rawWebhookUnavailable: true },
    { id: "waiting", status: "active", createdAt: today, followUp: { owner: "customer" } },
  ];
  const bookingRequests = [
    { id: "pending", status: "pending", createdAt: today, requestedStart: "2026-11-02T17:30:00Z" },
  ];
  const queues = buildAdminQueues({ jobs, customers: [], leads, bookingRequests }, today);
  const ids = Object.fromEntries(Object.entries(queues).map(([key, rows]) => [key, rows.map(row => row.id)]));
  expect(ids).toEqual({
    today: ["today"], upcoming: ["future"], overdue: ["past"], reply: ["new"], backlog: ["old"],
    decision: ["pending"], money: [],
  });
});

test("uses individual invoice lines and payments when opening a split balance", () => {
  const jobs = [{
    id: "job", status: "Complete", price: 100, amountPaid: 100,
    invoiceItems: [{ id: "work", name: "Work", amount: 75, invoiceId: "final" }],
    invoices: [{ id: "final", name: "Final" }, { id: "future", name: "Future", dueDate: "2026-11-20" }],
  }];
  const [balance] = buildAdminQueues({ jobs, customers: [] }, "2026-11-14").money;
  expect(balance).toMatchObject({ id: ["job", "final"], status: "$75.00 due", view: "jobInvoice" });
});
