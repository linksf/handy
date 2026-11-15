/* eslint-disable require-jsdoc, max-len */
import {createHash} from "node:crypto";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {sendNotification, PushSubscription, WebPushError} from "web-push";
import {dbForLeads} from "./leadWorkflow";
import {isOwnerAuth} from "./ownerAuth";

export const pushKeys = defineSecret("HANDY_WEB_PUSH_VAPID");
type Notice = {title: string; body: string; url: string; tag: string};
const idFor = (value: string) => createHash("sha256").update(value).digest("hex");

export function checkedEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid push endpoint.");
  const url = new URL(value);
  const host = url.hostname;
  const trusted = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" || host.endsWith(".web.push.apple.com") || host.endsWith(".notify.windows.com");
  if (!trusted || url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
      url.pathname === "/") throw new Error("Unsupported device push endpoint.");
  return url.href;
}

function config() {
  const {publicKey, privateKey, subject} = JSON.parse(pushKeys.value());
  if (!/^[\w-]{87}$/.test(publicKey) || !/^[\w-]{43}$/.test(privateKey) ||
    !/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) throw new Error("Web Push is unavailable.");
  return {publicKey, privateKey, subject};
}

export const getDevicePushConfig = onCall({secrets: [pushKeys]}, request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to enable notifications.");
  return {publicKey: config().publicKey};
});

export const registerDevicePush = onCall({secrets: [pushKeys]}, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to enable notifications.");
  const raw = request.data?.subscription;
  let endpoint;
  try { endpoint = checkedEndpoint(raw?.endpoint); }
  catch { throw new HttpsError("invalid-argument", "Unsupported notification endpoint."); }
  const {p256dh, auth} = raw?.keys || {};
  if (!/^[\w-]{87}$/.test(p256dh) || !/^[\w-]{22}$/.test(auth)) {
    throw new HttpsError("invalid-argument", "Invalid subscription keys.");
  }
  config();
  await dbForLeads().doc(`devicePush/${idFor(endpoint)}`).set({
    uid: request.auth.uid, owner: isOwnerAuth(request.auth), subscription: {endpoint, keys: {p256dh, auth}},
  });
  return {ok: true};
});

export const removeDevicePush = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to manage notifications.");
  let endpoint;
  try { endpoint = checkedEndpoint(request.data?.endpoint); }
  catch { throw new HttpsError("invalid-argument", "Invalid notification endpoint."); }
  const db = dbForLeads();
  const ref = db.doc(`devicePush/${idFor(endpoint)}`);
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).get("uid") === request.auth?.uid) tx.delete(ref);
  });
  return {ok: true};
});

export async function deliverDeviceNotice(field: "owner" | "uid", audience: boolean | string, notice: Notice): Promise<void> {
  const devices = await dbForLeads().collection("devicePush").where(field, "==", audience).get();
  if (devices.empty) return;
  const vapidDetails = config();
  await Promise.all(devices.docs.map(async device => {
    const subscription = device.get("subscription") as PushSubscription;
    try {
      checkedEndpoint(subscription?.endpoint);
      await sendNotification(subscription, JSON.stringify(notice), {
        TTL: 7200, topic: idFor(notice.tag).slice(0, 32), vapidDetails, timeout: 10000,
      });
    } catch (error) {
      if (error instanceof WebPushError && [404, 410].includes(error.statusCode)) {
        const db = dbForLeads();
        await db.runTransaction(async tx => {
          const latest = await tx.get(device.ref);
          if (latest.updateTime?.isEqual(device.updateTime)) tx.delete(device.ref);
        });
      } else {
        // Never log subscription endpoints, credentials, or provider response bodies.
        console.warn("Handy Web Push delivery failed", error instanceof WebPushError ? error.statusCode : "unavailable");
      }
    }
  }));
}

const alert = (eventId: string, title: string): Promise<void> => deliverDeviceNotice("owner", true, {
  title, body: "Open Handy to review.", url: "/admin/dashboard", tag: `owner-${idFor(eventId).slice(0, 24)}`,
});
export const pushNewLead = onDocumentCreated({document: "leads/{id}", secrets: [pushKeys]}, async event => {
  const lead = event.data?.data();
  if (lead && !lead.rawWebhookUnavailable && !lead.migratedAt) await alert(event.id, "New Handy lead");
});
export const pushNewInquiry = onDocumentCreated({document: "inquiries/{id}", secrets: [pushKeys]}, async event => {
  if (event.data?.get("status") === "new") await alert(event.id, "New Handy inquiry");
});
export const pushNewBooking = onDocumentCreated({document: "bookingRequests/{id}", secrets: [pushKeys]}, async event => {
  if (event.data?.get("status") === "pending") await alert(event.id, "Handy booking request");
});
