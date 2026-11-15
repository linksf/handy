import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {defineString} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {hash} from "./leadAutomationCore";
import {saveLeadEvent} from "./leadAutomationStore";
import {parseSmsEvent, SmsEvent, verifyTelnyx} from "./telnyxCore";

// Public verification material only. Never configure a Telnyx API key here.
const publicKey = defineString("TELNYX_PUBLIC_KEY", {default: "UNCONFIGURED"});
function db(): admin.firestore.Firestore {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}
function endpoint(region: string, route: string) {
  return onRequest({region, invoker: "public", timeoutSeconds: 15, maxInstances: 5}, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "POST") { res.set("Allow", "POST").status(405).json({error: "post_required"}); return; }
    if (!publicKey.value() || publicKey.value() === "UNCONFIGURED") { res.status(503).json({error: "verification_not_configured"}); return; }
    const raw = req.rawBody;
    if (!raw || raw.length > 512 * 1024) { res.status(413).json({error: "payload_too_large"}); return; }
    if (!verifyTelnyx(raw, req.get("telnyx-timestamp") || "", req.get("telnyx-signature-ed25519") || "", publicKey.value())) {
      res.status(401).json({error: "invalid_signature"}); return;
    }
    let event: SmsEvent;
    try { event = parseSmsEvent(raw); } catch { res.status(400).json({error: "invalid_event"}); return; }
    try {
      const supported = ["message.received", "message.sent", "message.finalized"].includes(event.event_type);
      const duplicate = await db().runTransaction(async (tx) => {
        const ref = db().doc(`telnyxEvents/${hash(event.id)}`);
        const old = await tx.get(ref);
        if (old.exists) return true;
        tx.create(ref, {event, route, receivedAt: admin.firestore.FieldValue.serverTimestamp(), status: supported ? "pending" : "ignored"});
        return false;
      });
      // Acknowledge only after durable commit; asynchronous processing may retry safely.
      res.status(200).json({received: true, duplicate});
    } catch {
      logger.error("telnyx_capture_failed", {route});
      res.status(503).json({error: "storage_unavailable"});
    }
  });
}
export const telnyxWebhook = endpoint("us-central1", "primary");
export const telnyxWebhookFallback = endpoint("us-east1", "fallback");

export async function processSmsEvent(store: admin.firestore.Firestore, ref: admin.firestore.DocumentReference, event: SmsEvent): Promise<void> {
  if (!["message.received", "message.sent", "message.finalized"].includes(event.event_type)) return;
  const payload = event.payload;
  // Separate immutable delivery records avoid out-of-order sent/finalized regressions.
  const messageRef = store.doc(`telnyxMessages/${hash(payload.id)}`);
  await messageRef.collection("events").doc(hash(event.id)).set({eventType: event.event_type, occurredAt: event.occurred_at, payload});
  if (event.event_type === "message.received") {
    const phone = payload.from!.phone_number!;
    // Explicit links take priority. Otherwise link only one exact matching active lead.
    const link = await store.doc(`telnyxPhoneLeadLinks/${hash(phone)}`).get();
    const matches = await store.collection("leads").where("phone", "==", phone).limit(3).get();
    const active = matches.docs.filter((d) => !["archived", "lost"].includes(d.get("status")));
    const leadId = link.get("leadId") || (active.length === 1 && matches.size < 3 ? active[0].id : null);
    if (!leadId || typeof leadId !== "string" || leadId.includes("/")) {
      await ref.update({status: "needs_review", reason: "lead_link_required"}); return;
    }
    const lead = await store.doc(`leads/${leadId}`).get();
    if (!lead.exists) { await ref.update({status: "needs_review", reason: "lead_missing"}); return; }
    await saveLeadEvent(store, {kind: "message", leadId, message: {
      id: `telnyx:${payload.id}`, leadId, sender: "Customer", text: payload.text!, sentAt: event.occurred_at, source: "telnyx",
    }});
    await ref.update({status: "processed", leadId});
  } else await ref.update({status: "processed"});
}
export const processTelnyxEvent = onDocumentWritten({document: "telnyxEvents/{eventId}", region: "us-central1", retry: true, timeoutSeconds: 60}, async (event) => {
  const snapshot = event.data?.after;
  if (!snapshot || snapshot.get("status") !== "pending") return;
  await processSmsEvent(db(), snapshot.ref, snapshot.get("event") as SmsEvent);
});
