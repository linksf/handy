import { pacificDay, shiftDay } from "../../src/utils/adminDates";

const today = pacificDay(new Date());
const day = offset => shiftDay(today, offset);
const clock = (offset, hour) => {
  const date = new Date(`${day(offset)}T${String(hour).padStart(2, "0")}:00:00Z`);
  const localHour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "numeric",
  }).format(date));
  date.setUTCHours(hour + (hour - localHour + 24) % 24);
  return date.toISOString();
};

const visitStart = clock(0, 10);
const bookingStart = clock(1, 11);
export const fixtures = {
  customers: [
    { id: "jordan", name: "Jordan Lee", address: "24 Alder Lane, Sample City" },
    { id: "drew", name: "Drew Patel", address: "12 Briar Street, Sample City" },
  ],
  jobs: [
    { id: "closet", title: "Install closet shelves", status: "Scheduled", customerId: "jordan", date: today,
      jobAddress: "24 Alder Lane, Sample City",
      visits: [{ id: "site-visit", kind: "Installation", start: visitStart, status: "scheduled", durationMinutes: 90 }] },
    { id: "gate", title: "Repair side gate", status: "In Progress", customerId: "drew", date: day(-3) },
    { id: "hinge", title: "Adjust cabinet hinges", status: "Complete", customerId: "jordan", date: day(-1),
      price: 225, amountPaid: 100, payStatus: "Partial" },
    { id: "shelf", title: "Mount laundry shelf", status: "Scheduled", customerId: "drew", date: day(3) },
    { id: "old-draft", title: "Replace closet track", status: "Draft", source: "thumbtack", createdAt: day(-26) },
  ],
  leads: [
    { id: "avery", name: "Avery Chen", title: "Hang an entry mirror", address: "19 Juniper Lane, Sample City",
      status: "active", source: "thumbtack", createdAt: today, description: "I have a 40-pound mirror and need help mounting it." },
    { id: "casey", name: "Casey Moore", title: "Adjust a sticking door", status: "active", createdAt: day(-18), rawWebhookUnavailable: true },
  ],
  thumbtackConversations: [{ id: "avery-thread", leadId: "avery", initialResponse: {
    status: "ready", text: "Hi Avery, what are the dimensions of the mirror, and what type of wall will it go on?",
  } }],
  inquiries: [{ id: "robin", name: "Robin Shah", address: "37 Laurel Way, Sample City", category: "fabrication", status: "new",
    description: "I’m looking for a small maple display stand.", createdAt: today }],
  bookingRequests: [
    { id: "rail", title: "Install stair handrail", clientName: "Sam Diaz", location: "18 Elm Court, Sample City",
      status: "pending", createdAt: today, requestedStart: bookingStart, requestedEnd: clock(1, 13) },
    { id: "competing", title: "Older window-trim request", status: "pending", createdAt: day(-10),
      requestedStart: clock(1, 12), requestedEnd: clock(1, 14) },
  ],
};

fixtures.customers.push(
  { id: "avery-contact", name: "Avery Chen", address: "19 Juniper Lane, Sample City", phone: "415-555-0119" },
  { id: "avery-duplicate", name: "Avery Chen (old profile)", address: "6 Linden Way, Sample City", phone: "+1 (415) 555-0119" },
);
Object.assign(fixtures.leads[0], { phone: "415-555-0119", customerId: "avery-duplicate" });
Object.assign(fixtures.inquiries[0], { email: "robin@example.test" });
fixtures.thumbtackConversations[0].initialResponseOpenAI = { text: "Hi Avery, can you share a photo of the wall and hanging hardware?" };
fixtures["thumbtackConversations/avery-thread/events"] = [
  { id: "mirror-message", kind: "message", sender: "Customer", sentAt: clock(0, 9), text: "The mirror weighs 40 pounds. Can you mount it above my entry bench?" },
];

fixtures.customers.push({ id: "billing-customer", name: "Taylor Brooks", address: "82 Cedar Avenue, Sample City" });
fixtures.jobs.push({
  id: "billing", title: "Repair kitchen cabinets", status: "Complete", customerId: "billing-customer",
  date: day(-2), price: 300, amountPaid: 80, payStatus: "Partial",
  expenses: [{ id: "cabinet-hardware", name: "Cabinet hardware", amount: 40, type: "Other", reimbursable: false }],
  invoiceItems: [{ id: "return-tune-up", kind: "item", name: "Return visit tune-up", amount: 60 }],
  visits: [{ id: "completed-cabinet-visit", kind: "Service", start: clock(-2, 10), durationMinutes: 90, status: "completed" }],
});
fixtures.payments = [
  { id: "cabinet-payment", jobId: "billing", amountCents: 8000, date: day(-1) },
];
fixtures.tools = [
  { id: "tool_preview_drill", name: "Cordless drill", category: "Power Tools" },
  { id: "tool_preview_level", name: "Level", category: "Measuring" },
];
fixtures.tasks = [
  { id: "task_preview_install", name: "Install hardware", toolIds: ["tool_preview_drill", "tool_preview_level"] },
];

const extrasJob = {
  id: "extras", title: "Repair laundry room wall", status: "In Progress", customerId: "jordan",
  jobAddress: "24 Alder Lane, Sample City", date: day(2), price: 250, amountPaid: 0,
  visits: [{ id: "return", kind: "Return visit", start: clock(2, 10), end: clock(2, 11), durationMinutes: 60, status: "scheduled", calendarEventId: "preview-return", syncStatus: "synced" }],
  tasks: [{ id: "wall", name: "Repair drywall", materials: [{ id: "drywall", name: "Drywall patch", qty: 1, cost: 18 }] }],
};
fixtures.jobs.push(extrasJob);
fixtures["jobs/extras/privateRecords"] = [
  { id: "access-default", type: "access", parking: "Driveway beside the white gate", entry: "Use the side door",
    contact: "Jordan Lee", phone: "415-555-0124", lastMile: "Walk past the garage." },
];
