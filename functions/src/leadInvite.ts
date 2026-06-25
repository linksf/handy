/* eslint-disable require-jsdoc, valid-jsdoc */
import {randomBytes} from "crypto";
import * as admin from "firebase-admin";
import {onCall, HttpsError} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function normalizePhoneDigits(s: unknown): string {
  const d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.slice(-10);
}

/**
 * After sign-in, client can match an open Thumbtack lead by phone (+ optional name).
 */
export const matchLeadInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const phone = normalizePhoneDigits(request.data?.phone);
  if (phone.length < 10) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number.");
  }
  const nameHint = String(request.data?.name || "").trim().toLowerCase();

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  const snap = await db.collection("leadInvites")
    .where("phoneNormalized", "==", phone)
    .where("status", "==", "open")
    .limit(10)
    .get();

  let matches = snap.docs;
  if (nameHint) {
    matches = matches.filter((d) => {
      const n = String(d.get("name") || "").trim().toLowerCase();
      return n.includes(nameHint) || nameHint.includes(n);
    });
  }

  if (matches.length === 0) {
    return {found: false};
  }
  if (matches.length > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Multiple open requests match. Use the link from your message or contact us.",
    );
  }

  const doc = matches[0];
  const token = doc.id;
  const uid = request.auth.uid;

  await doc.ref.update({
    clientUid: uid,
    status: "claimed",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const customerId = String(doc.get("customerId") || "");
  const jobId = String(doc.get("jobId") || "");
  if (customerId) {
    await db.doc(`customers/${customerId}`).update({
      clientUid: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  if (jobId) {
    await db.doc(`jobs/${jobId}`).update({
      bookingClientUid: uid,
    });
  }

  logger.info("Lead invite matched by phone", {token, uid, phone});
  return {found: true, token};
});
