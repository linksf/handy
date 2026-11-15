import { isPreliminaryJob } from "../constants";
import { pacificDay, recordDate } from "./adminDates";

export const intakeGroups = ["Next reply", "Waiting", "Needs details", "Ready to book", "Snoozed", "Resolved"];
const timestamp = value => recordDate(value)?.getTime() || 0;

export function intakeRows({ leads, inquiries, jobs, customers, intake }) {
  const today = pacificDay(new Date());
  const contacts = new Map(customers.map(row => [row.id, row]));
  const linkedJobs = new Set(leads.map(row => row.jobId).filter(Boolean));
  const leadIds = new Set(leads.map(row => row.id));
  const make = (kind, row, contact = row) => {
    const key = `${kind}:${row.id}`;
    const state = intake[key] || {};
    const followUp = row.followUp || row.assessment?.followUp;
    const evidence = followUp?.evidence?.map(item => item.messageId).join("|") || "";
    const newReply = followUp?.owner === "business" && evidence && state.acknowledgedEvidence !== evidence;
    const baseline = kind === "lead" && ["lost", "archived"].includes(row.status) ? "Resolved"
      : kind === "lead" && (row.status === "scheduled" || row.assessment?.appointment?.status === "confirmed") ? "Ready to book"
      : kind === "lead" && followUp?.owner === "customer" ? "Waiting"
      : kind === "inquiry" && row.status === "reviewed" ? "Waiting"
      : !contact.email && !contact.phone && !row.description && kind !== "lead" ? "Needs details" : "Next reply";
    const group = state.snoozeUntil > today ? "Snoozed"
      : newReply && ["Waiting", "Resolved"].includes(state.group) && !["lost", "archived"].includes(row.status)
        ? "Next reply" : state.group || baseline;
    return {
      key, kind, id: row.id, row, state, group, evidence,
      customerId: state.customerId || row.customerId || "",
      name: contact.name || "", phone: contact.phone || "", email: contact.email || "",
      address: row.jobAddress || row.assessment?.address || row.address || contact.address || "",
      title: row.title || (kind === "inquiry" ? `${row.category === "fabrication" ? "Fabrication" : "Handyman"} inquiry` : "Job request"),
      description: row.description || row.notes || "",
      jobId: state.jobId || row.jobId || (kind === "job" ? row.id : ""),
      createdAt: row.sourceCreatedAt || row.createdAt,
      label: { lead: "Thumbtack lead", inquiry: "Guest inquiry", job: "Preliminary job" }[kind],
    };
  };
  return [
    ...leads.map(row => make("lead", row)),
    ...inquiries.map(row => make("inquiry", row)),
    ...jobs.filter(row => intake[`job:${row.id}`] || (isPreliminaryJob(row) && !linkedJobs.has(row.id) && !leadIds.has(row.leadId || row.sourceThumbtackLeadId)))
      .map(row => make("job", row, contacts.get(row.customerId) || {})),
  ].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
}

const email = value => String(value || "").trim().toLowerCase();
const phone = value => String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export function customerMatches(source, customers) {
  const number = phone(source.phone);
  const address = email(source.email);
  return customers.filter(row => row.id === source.customerId || row.id === source.row?.customerId ||
    (number.length === 10 && phone(row.phone) === number) || (address && email(row.email) === address));
}
