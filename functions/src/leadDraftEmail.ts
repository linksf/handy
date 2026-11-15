/* eslint-disable require-jsdoc, valid-jsdoc, max-len */
import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import {OWNER_EMAIL, TIME_ZONE, hash} from "./leadAutomationCore";
import {workspaceAccessToken} from "./leadAutomationGoogle";
import {Row} from "./leadIntroCore";
const oauth = defineSecret("LEAD_AUTOMATION_GOOGLE_OAUTH");
export const DRAFT_EMAIL_CONFIG = "leadAutomationState/draftEmails";
export const DRAFT_EMAILS = "leadDraftEmails";
const clean = (s: unknown): string => String(s || "").replace(/[\r\n]+/g, " ").slice(0, 200);
const ready = (d: Row | undefined): boolean => Boolean(d && ["draft", "needs_review"].includes(d.status) && typeof d.text === "string" && d.text.trim());
export function draftEmailPlan(threadId: string, thread: Row): Row | null {
  const gemini = thread.initialResponse; const openai = thread.initialResponseOpenAI;
  const complete = ready(gemini) && ready(openai);
  if (!complete && gemini?.status !== "failed" && openai?.status !== "failed") return null;
  const kind = complete ? "complete" : "attention";
  const name = clean(thread.lead?.name) || "New customer";
  const section = (label: string, d: Row | undefined): string => {
    const model = d?.model ? ` (${clean(d.model)})` : "";
    if (!ready(d)) return `${label}${model}\n${d?.status === "failed" ? "Draft generation failed and may retry." : "Draft is still being generated."}`;
    const notes = Array.isArray(d?.review) ? d.review.filter((v: unknown) => typeof v === "string") : [];
    return `${label}${model}\n${d?.text}${notes.length ? `\n\nReview notes:\n${notes.map((v: string) => `- ${v}`).join("\n")}` : ""}`;
  };
  const received = gemini?.receivedAt || openai?.receivedAt;
  const date = received && Number.isFinite(Date.parse(received)) ? new Date(received).toLocaleString("en-US", {timeZone: TIME_ZONE}) : "See lead details";
  return {id: `${threadId}-${kind}`, kind, recipient: OWNER_EMAIL, leadId: String(thread.leadId || ""),
    subject: `${complete ? "New lead - both AI drafts" : "New lead - AI draft needs attention"}: ${name}`,
    body: [`New Thumbtack lead: ${name}`, `Project: ${clean(thread.lead?.jobTitle) || "See lead details"}`, `Lead received: ${date} Pacific`, "", "For your review only. No message has been sent to the customer.", "", section("GEMINI", gemini), "", "----------------------------------------", "", section("OPENAI", openai), "", "----------------------------------------", "", `Review lead: https://handy.omnificology.com/admin/leads/${encodeURIComponent(String(thread.leadId || ""))}`, "Availability is a calendar snapshot. Recheck before offering or booking a time.", ...(!complete ? ["A follow-up with both drafts will be emailed if both finish successfully."] : [])].join("\n")};
}
export class DraftEmailRejected extends Error {
  constructor(public status: number) {
    super(`draft_email_rejected_${status}`);
  }
}
export async function sendDraftEmail(token: string, plan: Row): Promise<string> {
  // All recipients are fixed here. Never address a customer or trust a payload recipient.
  const raw = [`From: ${OWNER_EMAIL}`, `To: ${OWNER_EMAIL}`, `Subject: =?UTF-8?B?${Buffer.from(plan.subject).toString("base64")}?=`,
    `Message-ID: <handy-drafts-${hash(plan.id)}@omnificology.com>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(plan.body).toString("base64").match(/.{1,76}/g)?.join("\r\n") || ""].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {method: "POST", headers: {"Authorization": `Bearer ${token}`, "Content-Type": "application/json"}, body: JSON.stringify({raw: Buffer.from(raw).toString("base64url")}), signal: AbortSignal.timeout(65000)});
  if (!r.ok) {
    // Explicit 4xx rejection did not accept the message; an ambiguous response must not be resent.
    if (r.status >= 400 && r.status < 500 && r.status !== 408) throw new DraftEmailRejected(r.status);
    throw new Error("draft_email_delivery_unknown");
  }
  const data = await r.json() as Row;
  if (typeof data.id !== "string" || !data.id) throw new Error("draft_email_delivery_unknown");
  return data.id;
}
export async function emailLeadDrafts(db: admin.firestore.Firestore, threadId: string, deps: {token: () => Promise<string>; send: (token: string, plan: Row) => Promise<string>}): Promise<string> {
  const thread = db.doc(`thumbtackConversations/${threadId}`);
  const configRef = db.doc(DRAFT_EMAIL_CONFIG);
  const eventRef = thread.collection("events").doc("initial-lead");
  const snapshots = await db.getAll(configRef, thread, eventRef);
  const [config, current, initial] = snapshots;
  const cutoff = config.get("enabledAt")?.toMillis?.(); const received = initial.get("receivedAt")?.toMillis?.();
  if (config.get("enabled") !== true || !Number.isFinite(cutoff) || initial.get("kind") !== "lead" || !Number.isFinite(received) || received < cutoff || !current.exists) return "ineligible";
  const plan = draftEmailPlan(threadId, current.data() || {});
  if (!plan) return "waiting";
  const outbox = db.doc(`${DRAFT_EMAILS}/${plan.id}`);
  const old = await outbox.get();
  if (["sent", "sending", "delivery_unknown"].includes(old.get("status"))) return "duplicate";
  // Authenticate before claiming; an OAuth outage can safely retry without consuming the send attempt.
  const token = await deps.token();
  const claimed = await db.runTransaction(async (tx) => {
    const [enabled, latest, first, previous] = await Promise.all([tx.get(configRef), tx.get(thread), tx.get(eventRef), tx.get(outbox)]);
    if (enabled.get("enabled") !== true || !Number.isFinite(enabled.get("enabledAt")?.toMillis?.()) || (first.get("receivedAt")?.toMillis?.() ?? -1) < enabled.get("enabledAt").toMillis()) return false;
    const fresh = draftEmailPlan(threadId, latest.data() || {});
    if (!fresh || fresh.kind !== plan.kind) return false;
    if (["sent", "sending", "delivery_unknown"].includes(previous.get("status"))) return false;
    // If complete already sent, never deliver a late failure alert from an older invocation.
    const complete = plan.kind === "attention" ? await tx.get(db.doc(`${DRAFT_EMAILS}/${threadId}-complete`)) : null;
    if (complete && ["sent", "sending", "delivery_unknown"].includes(complete.get("status"))) return false;
    Object.assign(plan, fresh);
    tx.set(outbox, {...plan, threadId, status: "sending", attempts: Number(previous.get("attempts") || 0) + 1, claimedAt: admin.firestore.FieldValue.serverTimestamp()});
    return true;
  });
  if (!claimed) return "duplicate";
  try {
    const messageId = await deps.send(token, plan);
    await outbox.update({status: "sent", messageId, sentAt: admin.firestore.FieldValue.serverTimestamp()});
    return "sent";
  } catch (error) {
    const rejected = error instanceof DraftEmailRejected;
    await outbox.update({status: rejected ? "rejected" : "delivery_unknown", lastError: rejected ? `gmail_http_${error.status}` : "delivery_unknown", failedAt: admin.firestore.FieldValue.serverTimestamp()});
    if (rejected) throw new Error("draft_email_rejected_retry");
    // Gmail offers no send idempotency key. Do not automatically retry an uncertain delivery.
    return "delivery_unknown";
  }
}
export const emailThumbtackDraftComparison = onDocumentWritten({document: "thumbtackConversations/{threadId}", secrets: [oauth], retry: true, timeoutSeconds: 180, maxInstances: 3}, async (event) => {
  if (!event.data?.after.exists) return;
  if (!admin.apps.length) admin.initializeApp();
  await emailLeadDrafts(admin.firestore(), event.params.threadId, {token: () => workspaceAccessToken(oauth.value()), send: sendDraftEmail});
});
