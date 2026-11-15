const {test, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {parseIncomingEvent, validateAssessment, calendarBlockReason, appointmentBody, managedFingerprint, pacificDate, hash} = require("../lib/leadAutomationCore");
const {CalendarApi, workspaceAccessToken, sendBrief} = require("../lib/leadAutomationGoogle");
const {renderBrief} = require("../lib/leadAutomation");
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const messages = [
  {id: "m1", leadId: "lead1", sender: "Business", text: "Can we meet July 10 at 10 AM for one hour?", sentAt: "2099-07-01T10:00:00Z"},
  {id: "m2", leadId: "lead1", sender: "Customer", text: "Yes, July 10 at 10 AM works. One hour is fine.", sentAt: "2099-07-01T10:05:00Z"},
];
function assessment() {
  return {clientName: "Example Client", address: "123 Example Street, San Francisco, CA", jobSummary: "Repair fence", importantDetails: ["Use side gate"], stage: "scheduled",
    appointment: {status: "confirmed", kind: "job", start: "2099-07-10T10:00:00-07:00", end: "2099-07-10T11:00:00-07:00", evidence: messages.map((m) => ({messageId: m.id, quote: m.text}))},
    followUp: {owner: "none", reason: "", dueAt: null, evidence: []}, needsReview: []};
}
const payload = {negotiationID: "584473051455422484", customer: {displayName: "Example"}, request: {description: "Fence"}};

test("direct and wrapped lead deliveries preserve long opaque IDs", () => {
  for (const data of [payload, {data: payload}, {eventType: "NegotiationCreatedV4", body: payload}, {payload: {negotiation: payload}}]) {
    assert.equal(parseIncomingEvent(data).leadId, payload.negotiationID);
    assert.equal(parseIncomingEvent(data).kind, "lead");
  }
});
test("both incoming and outgoing messages use the conversation path", () => {
  for (const sender of ["Business", "Customer"]) {
    const event = parseIncomingEvent({eventType: "MessageCreatedV4", data: {messageID: "m1", negotiationID: "n1", from: sender, text: "Hello", sentAt: "2026-09-23T15:00:00Z"}});
    assert.equal(event.kind, "message"); assert.equal(event.message.sender, sender);
  }
});
test("malformed messages never become customer accounts", () => {
  assert.throws(() => parseIncomingEvent({eventType: "MessageCreatedV4", data: payload}), /invalid_message/);
  assert.throws(() => parseIncomingEvent({negotiationID: 584473051455422484, customer: {name: "Example"}, request: {}}));
  assert.throws(() => parseIncomingEvent([]));
});
test("unrelated explicit webhook event types are ignored", () => {
  assert.equal(parseIncomingEvent({eventType: "ReviewCreated", data: payload}).kind, "ignored");
});
test("confirmed appointment requires exact evidence from both parties", () => {
  assert.equal(validateAssessment(assessment(), messages).appointment.status, "confirmed");
  const oneSided = assessment(); oneSided.appointment.evidence.pop();
  assert.throws(() => validateAssessment(oneSided, messages), /both_parties/);
  const fabricated = assessment(); fabricated.appointment.evidence[0].quote = "invented quote";
  assert.throws(() => validateAssessment(fabricated, messages), /unsupported_evidence/);
});
test("invalid times and unsupported cancellation fail validation", () => {
  const a = assessment(); a.appointment.start = "2099-07-10T10:00:00";
  assert.throws(() => validateAssessment(a, messages));
  const b = assessment(); b.appointment.end = "2099-07-10T09:00:00-07:00";
  assert.throws(() => validateAssessment(b, messages), /duration/);
  const c = assessment(); c.appointment.status = "cancelled"; c.appointment.evidence = [];
  assert.throws(() => validateAssessment(c, messages), /evidence/);
});
test("tentative appointments, missing durations and review items cannot sync", () => {
  const now = new Date("2099-07-01T10:00:00Z");
  assert.equal(calendarBlockReason(assessment(), now), null);
  for (const transform of [a => {a.appointment.status = "tentative";}, a => {a.appointment.end = null;}, a => {a.needsReview = ["Ambiguous date"];}]) {
    const a = assessment(); transform(a); assert.ok(calendarBlockReason(a, now));
  }
  assert.ok(calendarBlockReason(assessment(), new Date("2100-01-01")));
});
test("fingerprints normalize equivalent timezone offsets", () => {
  const body = appointmentBody(assessment(), "lead1");
  const equivalent = structuredClone(body); equivalent.start.dateTime = "2099-07-10T17:00:00Z";
  assert.equal(managedFingerprint(body), managedFingerprint(equivalent));
});

function mockCalendar() {
  const events = new Map(); const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(url); const method = init.method || "GET"; calls.push({url: u, ...init});
    if (u.pathname.endsWith("/events") && method === "GET") return Response.json({items: [...events.values()]});
    if (u.pathname.endsWith("/events") && method === "POST") {
      const body = JSON.parse(init.body);
      if (events.has(body.id)) return new Response("", {status: 409});
      events.set(body.id, {...body, etag: "etag-1"}); return Response.json(events.get(body.id));
    }
    const id = u.pathname.split("/").at(-1);
    if (!events.has(id)) return new Response("", {status: 404});
    if (method === "PATCH") {
      assert.equal(init.headers["If-Match"], events.get(id).etag);
      events.set(id, {...events.get(id), ...JSON.parse(init.body), etag: "etag-2"});
    }
    return Response.json(events.get(id));
  };
  return {events, calls, api: new CalendarApi("fake-test-token", "shane@omnificology.com")};
}
test("calendar create retries recover the same event even if conversation version changes", async () => {
  const {api, events, calls} = mockCalendar(); const desired = appointmentBody(assessment(), "lead1");
  const first = await api.synchronize("lead1", desired, null, "1", "job", false);
  const recovered = await api.synchronize("lead1", desired, null, "2", "job", false);
  assert.equal(first.eventId, recovered.eventId); assert.equal(events.size, 1);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.ok(calls.every((c) => c.url.pathname.includes("shane%40omnificology.com")));
  assert.ok(!("attendees" in [...events.values()][0]));
});
test("confirmed reschedule updates existing ID using etag", async () => {
  const {api, events, calls} = mockCalendar(); const desired = appointmentBody(assessment(), "lead1");
  const first = await api.synchronize("lead1", desired, null, "1", "job", false);
  desired.start.dateTime = "2099-07-11T10:00:00-07:00"; desired.end.dateTime = "2099-07-11T11:00:00-07:00";
  const next = await api.synchronize("lead1", desired, first, "2", "job", false);
  assert.equal(first.eventId, next.eventId); assert.equal(events.size, 1);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
});
test("manual calendar edits and deleted events are protected", async () => {
  const {api, events} = mockCalendar(); const desired = appointmentBody(assessment(), "lead1");
  const first = await api.synchronize("lead1", desired, null, "1", "job", false);
  events.get(first.eventId).summary = "Manual change";
  await assert.rejects(api.synchronize("lead1", desired, first, "2", "job", false), /edited_manually/);
  events.get(first.eventId).status = "cancelled";
  await assert.rejects(api.synchronize("lead1", desired, first, "2", "job", false), /deleted_manually/);
});
test("conflicting appointment blocks insert; transparent event does not", async () => {
  const {api, events} = mockCalendar(); const desired = appointmentBody(assessment(), "lead1");
  events.set("other", {id: "other", summary: "Busy", transparency: "opaque"});
  await assert.rejects(api.synchronize("lead1", desired, null, "1", "job", false), /calendar_conflict/);
  events.get("other").transparency = "transparent";
  await api.synchronize("lead1", desired, null, "1", "job", false);
  assert.equal(events.size, 2);
});
test("cancellation marks only the managed event and frees its time", async () => {
  const {api, events} = mockCalendar(); const desired = appointmentBody(assessment(), "lead1");
  const first = await api.synchronize("lead1", desired, null, "1", "job", false);
  await api.synchronize("lead1", {}, first, "2", "job", true);
  assert.match(events.get(first.eventId).summary, /^Cancelled/);
  assert.equal(events.get(first.eventId).transparency, "transparent");
  assert.equal(events.size, 1);
});
test("Google identity is checked before using the calendar or sending email", async () => {
  let count = 0;
  global.fetch = async () => Response.json(++count === 1 ? {access_token: "test"} : {email: "wrong@example.com", email_verified: true});
  await assert.rejects(workspaceAccessToken(JSON.stringify({email: "shane@omnificology.com", client_id: "test", client_secret: "test", refresh_token: "test"})), /wrong_google_account/);
});
test("email goes only to the configured owner with a stable message id", async () => {
  global.fetch = async (url, init) => {
    assert.equal(url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const message = Buffer.from(JSON.parse(init.body).raw, "base64url").toString();
    assert.match(message, /To: shane@omnificology.com\r\n/);
    assert.match(message, /Message-ID: <handy-brief-2026-09-23@omnificology.com>/);
    return Response.json({id: "sent-test"});
  };
  assert.equal(await sendBrief("test", "Daily brief", "Hello", "2026-09-23"), "sent-test");
});
test("Pacific dates work across daylight saving seasons and UTC midnight", () => {
  assert.equal(pacificDate(new Date("2026-09-24T02:00:00Z")), "2026-09-23");
  assert.equal(pacificDate(new Date("2026-12-24T07:00:00Z")), "2026-12-23");
});
test("brief distinguishes follow-ups and hides stale advice", () => {
  const now = new Date("2099-07-01T15:00:00Z"); const a = assessment();
  a.followUp = {owner: "business", reason: "Send estimate", dueAt: null, evidence: []};
  const thread = {leadId: "1", version: 1, assessedVersion: 1, assessment: a};
  assert.match(renderBrief(now, [], [thread], []), /Your follow-up: Send estimate/);
  const stale = renderBrief(now, [], [{...thread, version: 2, dirty: true}], []);
  assert.doesNotMatch(stale, /Your follow-up: Send estimate/); assert.match(stale, /waiting to be processed/);
});
test("a recent client wait is not automatically a due follow-up", () => {
  const now = new Date("2099-07-01T15:00:00Z"); const a = assessment();
  a.followUp = {owner: "customer", reason: "Waiting for measurements", dueAt: null, evidence: []};
  const thread = {version: 1, assessedVersion: 1, assessment: a, updatedAt: {toMillis: () => now.getTime()}};
  assert.doesNotMatch(renderBrief(now, [], [thread], []), /Waiting on client:/);
  thread.updatedAt.toMillis = () => now.getTime() - 49 * 3600000;
  assert.match(renderBrief(now, [], [thread], []), /Waiting on client:/);
});
test("calendar read failures appear in the brief instead of a false empty schedule", () => {
  const brief = renderBrief(new Date(), [], [], ["Calendar could not be read."]);
  assert.match(brief, /could not be verified/); assert.doesNotMatch(brief, /No upcoming appointments/);
});
test("provider billing errors retain only a safe machine reason", async () => {
  const {requestJson} = require('../lib/leadAutomationGoogle');
  global.fetch = async () => Response.json({error:{message:'Private provider message',details:[{reason:'BILLING_DISABLED'}]}},{status:403});
  await assert.rejects(requestJson('https://example.test'), {message:'provider_http_403_billing_disabled'});
  global.fetch = async () => Response.json({error:{message:'Private provider message',details:[{reason:'sensitive text must not be logged'}]}},{status:403});
  await assert.rejects(requestJson('https://example.test'), {message:'provider_http_403'});
  global.fetch = async () => new Response('<html>error</html>',{status:503});
  await assert.rejects(requestJson('https://example.test'), {message:'provider_http_503'});
});
test("worker remains degraded when failed conversations are waiting for retry", () => {
  const {conversationHealth} = require('../lib/leadAutomation');
  assert.deepEqual(conversationHealth([{dirty:true,lastError:'provider_http_403_billing_disabled'},{dirty:false,lastError:null}]),{status:'degraded',lastError:'cloud_billing_disabled',failedConversations:1,pendingConversations:1});
  assert.equal(conversationHealth([{dirty:true,lastError:'provider_http_403'}]).status,'degraded');
  assert.equal(conversationHealth([{dirty:true,lastError:null}]).status,'processing');
  assert.equal(conversationHealth([{dirty:false,lastError:null}]).status,'healthy');
});
