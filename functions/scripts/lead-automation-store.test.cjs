const {test} = require("node:test");
const assert = require("node:assert/strict");
const {saveLeadEvent, THREADS} = require("../lib/leadAutomationStore");
const {hash} = require("../lib/leadAutomationCore");

// An in-memory adapter exercises ingestion behavior without touching production.
// Firestore's own concurrency/locking guarantees still require an emulator/live integration test.
function memoryDb() {
  const documents = new Map();
  const snapshot = (path) => ({exists: documents.has(path), get: (field) => documents.get(path)?.[field]});
  const ref = (path) => ({path, get: async () => snapshot(path), collection: (name) => collection(`${path}/${name}`)});
  const collection = (path) => ({doc: (id) => ref(`${path}/${id}`), where: () => ({limit: () => ({get: async () => ({empty: true, docs: []})})})});
  return {
    documents,
    collection,
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: async (reference) => snapshot(reference.path),
        create: (reference, data) => {assert.ok(!documents.has(reference.path)); writes.push(() => documents.set(reference.path, data));},
        set: (reference, data) => writes.push(() => documents.set(reference.path, {...documents.get(reference.path), ...data})),
      });
      for (const write of writes) write();
      return result;
    },
  };
}
const message = {kind: "message", leadId: "lead1", message: {id: "message1", leadId: "lead1", sender: "Customer", text: "Hello", sentAt: "2026-09-23T15:00:00Z"}};
const lead = {kind: "lead", leadId: "lead1", payload: {}};
const path = `${THREADS}/${hash("lead1")}`;

test("duplicate message deliveries do not increment version or duplicate history", async () => {
  const db = memoryDb();
  await saveLeadEvent(db, message);
  await saveLeadEvent(db, message);
  assert.equal(db.documents.get(path).version, 1);
  assert.equal(db.documents.size, 2);
});
test("a message arriving before its lead is preserved when the lead arrives", async () => {
  const db = memoryDb();
  await saveLeadEvent(db, message);
  await saveLeadEvent(db, lead, {name: "Example Client", jobInfo: "Repair fence"});
  assert.equal(db.documents.get(path).version, 2);
  assert.equal(db.documents.get(path).lead.name, "Example Client");
  assert.equal(db.documents.size, 3);
});
test("two distinct messages preserve both directions and request another processing pass", async () => {
  const db = memoryDb();
  await saveLeadEvent(db, lead, {name: "Example Client"});
  await saveLeadEvent(db, message);
  await saveLeadEvent(db, {...message, message: {...message.message, id: "message2", sender: "Business"}});
  assert.equal(db.documents.get(path).version, 3);
  assert.equal(db.documents.get(path).dirty, true);
  assert.equal(db.documents.get(path).nextAttemptAt.toMillis(), 0);
});
test("duplicate lead replay does not erase conversation progress", async () => {
  const db = memoryDb();
  await saveLeadEvent(db, lead, {name: "Example Client"});
  await saveLeadEvent(db, message);
  await saveLeadEvent(db, lead, {name: "Wrong replacement"});
  assert.equal(db.documents.get(path).version, 2);
  assert.equal(db.documents.get(path).lead.name, "Example Client");
});

test("initial lead event retains its raw payload and initial facts for draft generation", async () => {
  const db = memoryDb();
  const payload = {negotiationID: "lead1", request: {description: "Repair a chair", proposedTimes: []}};
  const facts = {name: "Example Client", jobInfo: "Repair a chair"};
  await saveLeadEvent(db, {...lead, payload}, facts);
  const saved = db.documents.get(`${path}/events/initial-lead`);
  assert.deepEqual(saved.payload, payload);
  assert.deepEqual(saved.leadFacts, facts);
  await saveLeadEvent(db, {...lead, payload: {request: {description: "changed"}}}, {name: "Changed"});
  assert.deepEqual(db.documents.get(`${path}/events/initial-lead`).payload, payload);
});
