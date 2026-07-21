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
 * After sign-in, client can match an open Thumbtack lead by Customer ID.
 */
export const matchLeadInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const thumbtackCustomerId = String(
    request.data?.thumbtackCustomerId || "",
  ).trim();
  if (!/^\d{15,20}$/.test(thumbtackCustomerId)) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a valid Thumbtack Customer ID.",
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  const snap = await db.collection("leadInvites")
    .where("thumbtackCustomerId", "==", thumbtackCustomerId)
    .where("status", "==", "open")
    .limit(5)
    .get();

  if (snap.empty) {
    return {found: false};
  }
  if (snap.size > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Multiple open requests match that Customer ID. " +
        "Use the link from your message or contact us.",
    );
  }

  const doc = snap.docs[0];
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

  logger.info("Lead invite matched by Thumbtack Customer ID", {
    token,
    uid,
    thumbtackCustomerId,
  });
  return {found: true, token};
});
