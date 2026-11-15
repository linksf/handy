/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {randomUUID} from "crypto";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";
import {HttpFailure, requestJson, workspaceAccessToken} from "./leadAutomationGoogle";
import {hash, TIME_ZONE} from "./leadAutomationCore";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIELDS = "names,emailAddresses,phoneNumbers,addresses,biographies,userDefined,memberships,metadata";
const oauth = defineSecret("LEAD_CONTACTS_GOOGLE_OAUTH");
const cleanName = (s: unknown): string => String(s || "").replace(/^📌\s*/, "").trim().toLowerCase();

export function matchContact(people: Row[], customerId: string, name: string, email: string): Row | undefined {
  const own = people.filter((p) => p.userDefined?.some((f: Row) => f.key === "Handy customer ID" && f.value === customerId));
  if (own.length > 1) throw new Error("contact_duplicate_review_required");
  if (own.length) return own[0];
  // Relay numbers and names alone cannot safely establish a person's identity.
  const matches = email ? people.filter((p) => p.emailAddresses?.some((e: Row) => String(e.value).toLowerCase() === email.toLowerCase()) && p.names?.some((n: Row) => cleanName(n.displayName || n.unstructuredName) === cleanName(name))) : [];
  if (matches.length > 1) throw new Error("contact_ambiguous_match");
  return matches[0];
}

export function contactPatch(existing: Row | undefined, input: Row, group: string): Row {
  const patch: Row = {};
  if (!existing?.names?.length) patch.names = [{unstructuredName: `📌 ${String(input.name).replace(/^📌\s*/, "").trim()}`}];
  if (!existing?.phoneNumbers?.length && input.phone) patch.phoneNumbers = [{value: input.phone, type: "Thumbtack"}];
  if (!existing?.emailAddresses?.length && input.email) patch.emailAddresses = [{value: input.email, type: "other"}];
  if (!existing?.addresses?.length && input.address) patch.addresses = [{formattedValue: input.address, type: "other"}];
  const marker = input.leadId ? `[Thumbtack lead ${input.leadId}]` : `[Handy job ${input.jobId}]`;
  const notes = String(existing?.biographies?.[0]?.value || "");
  if (!notes.includes(marker)) patch.biographies = [{contentType: "TEXT_PLAIN", value: [notes, `${marker}\n${input.title}\n${input.notes || ""}\nHandy: https://handy.omnificology.com${input.leadId ? `/admin/leads/${input.leadId}` : ""}\n${input.leadId ? `Lead ID: ${input.leadId}` : `Customer ID: ${input.customerId}`}\nLead source: Thumbtack. Phone supplied by Thumbtack; may be a relay number.`].filter(Boolean).join("\n\n")}];
  const tags = existing?.userDefined || [];
  if (!tags.some((f: Row) => f.key === "Handy customer ID" && f.value === input.customerId)) patch.userDefined = [...tags, {key: "Handy customer ID", value: input.customerId}];
  const memberships = (existing?.memberships || []).filter((m: Row) => m.contactGroupMembership);
  if (!memberships.some((m: Row) => m.contactGroupMembership.contactGroupResourceName === group)) patch.memberships = [...memberships, {contactGroupMembership: {contactGroupResourceName: group}}];
  return patch;
}

export class ContactsApi {
  constructor(private token: string) {}
  call(path: string, method = "GET", body?: Row): Promise<Row> {
    return requestJson(`https://people.googleapis.com/v1/${path}`, {method, headers: {"Authorization": `Bearer ${this.token}`, "Content-Type": "application/json"}, ...(body ? {body: JSON.stringify(body)} : {})});
  }
  async list(): Promise<Row[]> {
    const people: Row[] = []; let page = "";
    do {
      const result = await this.call(`people/me/connections?personFields=${FIELDS}&pageSize=1000&sources=READ_SOURCE_TYPE_CONTACT${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      people.push(...result.connections || []); page = result.nextPageToken || "";
    } while (page);
    return people;
  }
  async group(): Promise<string> {
    let page = "";
    do {
      const result = await this.call(`contactGroups?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      const found = (result.contactGroups || []).find((g: Row) => g.name === "Thumbtack");
      if (found) return found.resourceName;
      page = result.nextPageToken || "";
    } while (page);
    return String((await this.call("contactGroups", "POST", {contactGroup: {name: "Thumbtack"}})).resourceName);
  }
  get(resource: string): Promise<Row> {
    return this.call(`${resource}?personFields=${FIELDS}&sources=READ_SOURCE_TYPE_CONTACT`);
  }
  async write(existing: Row | undefined, patch: Row): Promise<Row> {
    if (existing && !Object.keys(patch).length) return existing;
    return existing ? this.call(`${existing.resourceName}:updateContact?updatePersonFields=${Object.keys(patch).join(",")}&personFields=${FIELDS}`, "PATCH", {...patch, etag: existing.etag, metadata: existing.metadata}) :
      this.call(`people:createContact?personFields=${FIELDS}`, "POST", patch);
  }
}

export async function syncContactJob(db: admin.firestore.Firestore, api: ContactsApi, people: Row[], group: string, job: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const data = job.data();
  const customerId = String(data.customerId || "");
  if (!customerId) throw new Error("contact_customer_missing");
  const record = db.doc(`leadContactJobs/${job.id}`);
  const mapping = db.doc(`leadContactCustomers/${hash(customerId)}`);
  const [state, map, customer, invite] = await Promise.all([record.get(), mapping.get(), db.doc(`customers/${customerId}`).get(), data.leadInviteToken ? db.doc(`leadInvites/${data.leadInviteToken}`).get() : Promise.resolve(null)]);
  if (state.get("status") === "synced") return;
  if (!customer.get("name")) throw new Error("contact_name_missing");
  const input = {customerId, jobId: job.id, name: customer.get("name"), email: customer.get("email") || invite?.get("email") || "", phone: customer.get("phone") || "", address: customer.get("address") || "", title: data.title || "Thumbtack job", notes: invite?.get("jobNotes") || ""};
  let existing: Row | undefined;
  if (map.get("resourceName")) {
    try {
      existing = await api.get(map.get("resourceName"));
    } catch (e) {
      if (e instanceof HttpFailure && e.status === 404) throw new Error("contact_deleted_manually");
      throw e;
    }
    if (existing.metadata?.deleted) throw new Error("contact_deleted_manually");
  } else existing = matchContact(people, customerId, input.name, input.email);
  // Creation has no idempotency key: recover a prior ambiguous write by its marker,
  // but never blindly create a second contact after a timeout or process crash.
  if (!existing && ["creating", "creation_unknown"].includes(String(map.get("status")))) throw new Error("contact_creation_unknown_review_required");
  if (!existing) await mapping.set({status: "creating", customerId, attemptedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
  let saved;
  try {
    saved = await api.write(existing, contactPatch(existing, input, group));
  } catch (e) {
    if (!existing) await mapping.set({status: e instanceof HttpFailure && e.status >= 400 && e.status < 500 ? "failed" : "creation_unknown"}, {merge: true});
    throw e;
  }
  if (!saved.resourceName) throw new Error("contact_resource_missing");
  await mapping.set({status: "synced", customerId, resourceName: saved.resourceName}, {merge: true});
  await record.set({status: "synced", customerId, resourceName: saved.resourceName, syncedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: null});
  const index = people.findIndex((p) => p.resourceName === saved.resourceName);
  if (index >= 0) people[index] = saved; else people.push(saved);
}

export async function syncContactLead(db: admin.firestore.Firestore, api: ContactsApi, people: Row[], group: string, lead: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const d = lead.data(); const input = {leadId: lead.id, customerId: d.customerId || d.reservedCustomerId, name: d.name, email: d.email || "", phone: d.phone || "", address: d.address || "", title: d.title, notes: d.description || ""};
  if (!input.name || !input.customerId) throw new Error("contact_lead_identity_missing");
  const record = db.doc(`leadContactLeads/${lead.id}`); const mapping = db.doc(`leadContactCustomers/${hash(input.customerId)}`);
  const [state, map] = await Promise.all([record.get(), mapping.get()]);
  if (state.get("status") === "synced") return;
  let existing: Row | undefined;
  if (map.get("resourceName")) {
    try {
      existing = await api.get(map.get("resourceName"));
    } catch (e) {
      if (e instanceof HttpFailure && e.status === 404) throw new Error("contact_deleted_manually"); throw e;
    }
    if (existing.metadata?.deleted) throw new Error("contact_deleted_manually");
  } else existing = matchContact(people, input.customerId, input.name, input.email);
  if (!existing && ["creating", "creation_unknown"].includes(String(map.get("status")))) throw new Error("contact_creation_unknown_review_required");
  if (!existing) await mapping.set({status: "creating", customerId: input.customerId}, {merge: true});
  let saved;
  try {
    saved = await api.write(existing, contactPatch(existing, input, group));
  } catch (e) {
    if (!existing) await mapping.set({status: e instanceof HttpFailure && e.status >= 400 && e.status < 500 ? "failed" : "creation_unknown"}, {merge: true}); throw e;
  }
  await mapping.set({status: "synced", customerId: input.customerId, resourceName: saved.resourceName}, {merge: true});
  await record.set({status: "synced", resourceName: saved.resourceName, lastError: null, syncedAt: admin.firestore.FieldValue.serverTimestamp()});
  const index = people.findIndex((p) => p.resourceName === saved.resourceName); if (index >= 0) people[index] = saved; else people.push(saved);
}

export const syncThumbtackContacts = onSchedule({schedule: "every 5 minutes", timeZone: TIME_ZONE, timeoutSeconds: 540, maxInstances: 1, concurrency: 1, secrets: [oauth], retryCount: 0}, async () => {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore(); const ref = db.doc("leadAutomationState/contacts"); const owner = randomUUID();
  const config = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.get("enabled") || !s.get("startAt") || Number(s.get("leaseUntil") || 0) > Date.now()) return null;
    tx.update(ref, {owner, leaseUntil: Date.now() + 11 * 60000}); return s.data();
  });
  if (!config) return;
  try {
    const leadFirst = (await db.doc("leadAutomationState/leadWorkflow").get()).get("enabled");
    const jobs = await db.collection(leadFirst ? "leads" : "jobs").where("createdAt", ">=", config.startAt).get();
    const records = leadFirst ? "leadContactLeads" : "leadContactJobs";
    const pending = [];
    for (const job of jobs.docs.filter((j) => j.get("source") === "thumbtack")) {
      const state = await db.doc(`${records}/${job.id}`).get();
      if (state.get("status") !== "synced" && Number(state.get("nextAttemptAt") || 0) <= Date.now()) pending.push(job);
    }
    if (pending.length) {
      const api = new ContactsApi(await workspaceAccessToken(oauth.value()));
      const people = await api.list(); const group = await api.group();
      const deadline = Date.now() + 4 * 60000;
      for (const job of pending.slice(0, 10)) {
        if (Date.now() > deadline) break;
        try {
          if (leadFirst) await syncContactLead(db, api, people, group, job);
          else await syncContactJob(db, api, people, group, job);
        } catch (e) {
          const code = e instanceof Error && /^[a-z][a-z0-9_]{0,159}$/.test(e.message) ? e.message : "contact_sync_failed";
          await db.doc(`${records}/${job.id}`).set({status: "failed", lastError: code, nextAttemptAt: Date.now() + 30 * 60000}, {merge: true});
        }
      }
    }
    const failed = await db.collection(records).where("status", "==", "failed").get();
    await ref.set({status: failed.empty ? "healthy" : "degraded", failedJobs: failed.size, lastError: failed.empty ? null : "contact_jobs_failed", lastRunAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
  } catch (e) {
    const code = e instanceof Error && /^[a-z][a-z0-9_]{0,159}$/.test(e.message) ? e.message : "contact_sync_failed";
    await ref.set({status: "degraded", lastError: code}, {merge: true});
  } finally {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref); if (s.get("owner") === owner) tx.update(ref, {leaseUntil: 0});
    });
  }
});
