import { buildJobInvoiceLines, invoicePaid, jobInvoices, totalCentsFromLines } from "../../shared/invoices.js";
import { bookingRequestRangeMs, findConflictingBooking } from "./bookingConflicts";
import { partReminder } from "./jobExtras";
import { intakeRows } from "./intake";
import { isPreliminaryJob } from "../constants";
import { displayDay, displayPacificTime, pacificDay, recordDate, shiftDay } from "./adminDates";

const formatMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const scheduled = new Set(["Scheduled", "In Progress"]);
const bookedVisit = new Set(["scheduled", "confirmed", "in progress", "in_progress"]);
const orderByDay = (a, b) => a.day.localeCompare(b.day) || (a.start ?? Infinity) - (b.start ?? Infinity);

export function jobCommitments(job, approvedBooking) {
  if (!scheduled.has(job.status)) return [];
  if (job.visits?.length) {
    return job.visits.flatMap((visit, index) => {
      const day = pacificDay(visit.start);
      return day && bookedVisit.has(String(visit.status).toLowerCase())
        ? [{ key: visit.id || index, day, time: visit.start, address: visit.address, label: visit.kind || "Visit" }]
        : [];
    });
  }
  const date = pacificDay(job.date);
  const bookingDay = pacificDay(approvedBooking?.requestedStart);
  // Preserve manual changes to a legacy job date. Older approvals used the UTC date.
  const time = !date || date === bookingDay || date === recordDate(approvedBooking?.requestedStart)?.toISOString().slice(0, 10)
    ? approvedBooking?.requestedStart : null;
  const day = pacificDay(time) || date;
  return day ? [{ key: "legacy", day, time, label: "Visit" }] : [];
}

export function buildAdminQueues({ jobs, customers, leads = [], inquiries = [], bookingRequests = [], intake = {} }, today) {
  const queues = { today: [], reply: [], decision: [], money: [], overdue: [], upcoming: [], backlog: [] };
  const cutoff = shiftDay(today, -6);
  const customersById = new Map(customers.map(customer => [customer.id, customer]));
  const approvedByJob = new Map(bookingRequests.filter(row => row.status === "approved" && row.linkedJobId)
    .map(row => [row.linkedJobId, row]));
  const leadJobs = new Set(leads.map(lead => lead.jobId).filter(Boolean));
  const intakeByKey = new Map(intakeRows({ leads, inquiries, jobs, customers, intake }).map(row => [row.key, row]));
  const suppressed = key => ["Waiting", "Snoozed", "Resolved"].includes(intakeByKey.get(key)?.group);
  const leadIds = new Set(leads.map(lead => lead.id));
  const addIntake = (queue, row, date, historical = false) => {
    const day = pacificDay(date);
    queues[historical || !day || day < cutoff ? "backlog" : queue].push({
      ...row, day, start: recordDate(date)?.getTime(),
      detail: [row.detail, day ? `Received ${displayDay(day)}` : "Received date unknown"].filter(Boolean).join(" · "),
      revision: row.revision || day,
    });
  };

  for (const lead of leads) {
    const followUp = lead.followUp || lead.assessment?.followUp;
    if (suppressed(`lead:${lead.id}`)) continue;
    const needsDecision = !!lead.schedulingReview || !!lead.lastError;
    const needsReply = followUp?.owner === "business" || (lead.status === "active" && !followUp);
    if (["lost", "archived"].includes(lead.status) || (!needsDecision && !needsReply)) continue;
    const activity = lead.sourceCreatedAt || lead.createdAt;
    addIntake(needsDecision ? "decision" : "reply", {
      key: `lead:${lead.id}`, id: lead.id, view: "lead/:id", title: lead.name || lead.title || "New lead",
      status: needsDecision ? "Review needed" : "Thumbtack lead", action: needsDecision ? "Review lead" : "Review reply",
      detail: [lead.title !== lead.name && lead.title, lead.address, followUp?.reason].filter(Boolean).join(" · "),
      revision: JSON.stringify([lead.status, lead.schedulingReview, lead.lastError, followUp?.owner, followUp?.reason, followUp?.dueAt, followUp?.evidence?.map(item => item.messageId)]),
    }, activity, lead.rawWebhookUnavailable || lead.legacyDraft);
  }
  for (const inquiry of inquiries.filter(row => row.status === "new" && !suppressed(`inquiry:${row.id}`))) {
    addIntake("reply", {
      key: `inquiry:${inquiry.id}`, id: inquiry.id, view: "inquiry/:id", title: inquiry.name || "Guest inquiry",
      status: "New inquiry", action: "Review inquiry", detail: inquiry.address,
    }, inquiry.createdAt);
  }
  for (const booking of bookingRequests.filter(row => row.status === "pending")) {
    const requestedDay = pacificDay(booking.requestedStart);
    const { start, end } = bookingRequestRangeMs(booking);
    const conflict = start && end && findConflictingBooking(bookingRequests, start, end, { excludeId: booking.id });
    addIntake("decision", {
      key: `booking:${booking.id}`, id: booking.id, view: "booking/:id", title: booking.title || "Booking request",
      status: conflict ? "Booking conflict" : "Pending booking", action: "Review booking",
      detail: [booking.clientName, requestedDay && `Requested ${displayDay(requestedDay)}`, displayPacificTime(booking.requestedStart), conflict && `Overlaps ${conflict.title || "another request"}`].filter(Boolean).join(" · "),
      revision: String(recordDate(booking.requestedStart)?.getTime() ?? ""),
    }, booking.createdAt, !!requestedDay && requestedDay < today);
  }
  for (const job of jobs) {
    const customer = customersById.get(job.customerId);
    const title = job.title || "Untitled job";
    const address = job.jobAddress || customer?.address;
    const approvedBooking = approvedByJob.get(job.id);
    const contact = [customer?.name, address || approvedBooking?.location].filter(Boolean).join(" · ");
    const base = { id: job.id, title, view: "job/:id" };
    if (isPreliminaryJob(job) && !suppressed(`job:${job.id}`) && !leadJobs.has(job.id) && !leadIds.has(job.leadId || job.sourceThumbtackLeadId)) {
      addIntake("decision", { ...base, key: `draft:${job.id}`, id: `job:${job.id}`, view: "intake/:id", status: "Preliminary job", action: "Review job", detail: contact }, job.createdAt);
    }
    for (const visit of jobCommitments(job, approvedBooking)) {
      const overdue = visit.day < today;
      const bucket = overdue ? "overdue" : visit.day === today ? "today" : "upcoming";
      queues[bucket].push({
        ...base, key: `visit:${job.id}:${visit.key}`, action: overdue ? "Review job" : "Open visit",
        status: overdue ? "Overdue visit" : job.status, day: visit.day, start: recordDate(visit.time)?.getTime(),
        detail: [visit.label, displayDay(visit.day), displayPacificTime(visit.time), visit.address || contact].filter(Boolean).join(" · "),
        revision: JSON.stringify([visit.day, recordDate(visit.time)?.getTime(), job.status]),
      });
    }
    for (const part of job.parts || []) {
      const reminder = partReminder(part, today);
      if (reminder) queues.decision.push({
        ...base, key: `part:${job.id}:${part.id}`, view: "jobSection", id: [job.id, "parts"],
        title: part.name, status: reminder[1], action: "Review parts", day: reminder[0],
        detail: [title, part.vendor, displayDay(reminder[0])].filter(Boolean).join(" · "),
        revision: JSON.stringify([part.status, part.expectedOn, part.returnBy, part.reminderOn]),
      });
    }
    // With the current data model, completed work is the default collection cue.
    // For other jobs, only show a balance if an invoice has an explicit due date.
    const balances = jobInvoices(job).flatMap(invoice => {
      const dueDay = pacificDay(invoice.dueDate);
      if (["Draft", "Cancelled", "Archived"].includes(job.status) || (dueDay ? dueDay > today : job.status !== "Complete")) return [];
      const balance = totalCentsFromLines(buildJobInvoiceLines(job, invoice.id)) - Math.round(invoicePaid(job, invoice.id) * 100);
      return balance > 0 ? [{ id: invoice.id, name: invoice.name || "Invoice", dueDay, balance }] : [];
    });
    for (const invoice of balances) {
      queues.money.push({
        ...base, key: `balance:${job.id}:${invoice.id}`, view: "jobInvoice", id: [job.id, invoice.id],
        day: invoice.dueDay, status: `${formatMoney.format(invoice.balance / 100)} due`, action: "Open invoice",
        detail: [invoice.name, invoice.dueDay && displayDay(invoice.dueDay), contact].filter(Boolean).join(" · "),
        revision: `${invoice.dueDay}:${invoice.balance}`,
      });
    }
  }
  for (const key of ["today", "upcoming", "overdue", "money"]) queues[key].sort(orderByDay);
  for (const key of ["reply", "decision", "backlog"]) queues[key].sort((a, b) => orderByDay(b, a));
  return queues;
}
