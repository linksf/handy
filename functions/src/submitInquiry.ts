/* eslint-disable require-jsdoc, valid-jsdoc */
import * as admin from "firebase-admin";
import {generateOpaqueCustomerId} from "@handy/shared";
import {HttpsError, onCall} from "firebase-functions/v2/https";

const stringFields = [
  "phone",
  "email",
  "address",
  "preferredTiming",
  "howFoundUs",
  "propertyType",
  "indoorOutdoor",
  "urgency",
  "estimatedHours",
  "accessNotes",
  "materials",
  "dimensionsNotes",
  "installOrPickup",
  "finishNotes",
  "deadline",
] as const;

function initializeAdmin(): FirebaseFirestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

function submittedStringFields(
  data: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    stringFields.map((field) => [field, String(data[field] || "").trim()]),
  );
}

function submittedPhotoUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Accepts a guest inquiry and atomically creates its preliminary customer.
 */
export const submitInquiry = onCall({invoker: "public"}, async (request) => {
  const data = (request.data || {}) as Record<string, unknown>;
  const category = String(data.category || "");
  if (category !== "handyman" && category !== "fabrication") {
    throw new HttpsError("invalid-argument", "Choose a valid category.");
  }

  const name = String(data.name || "").trim();
  const description = String(data.description || "").trim();
  if (!name || !description) {
    throw new HttpsError(
      "invalid-argument",
      "Name and description are required.",
    );
  }

  const db = initializeAdmin();
  const customerId = generateOpaqueCustomerId();
  const inquiryRef = db.collection("inquiries").doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const optionalFields = submittedStringFields(data);
  const clientUid = request.auth?.uid || null;
  const batch = db.batch();

  batch.create(db.doc(`customers/${customerId}`), {
    name,
    phone: optionalFields.phone,
    email: optionalFields.email,
    address: optionalFields.address,
    status: "preliminary",
    source: "guest_inquiry",
    clientUid,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.create(inquiryRef, {
    category,
    name,
    description,
    ...optionalFields,
    photoUrls: submittedPhotoUrls(data.photoUrls),
    status: "new",
    customerId,
    clientUid,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await batch.commit();

  return {ok: true, inquiryId: inquiryRef.id, customerId};
});

/**
 * Links a recently submitted inquiry to the client's authenticated account.
 */
export const linkInquiryToClient = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const inquiryId = String(request.data?.inquiryId || "").trim();
  const customerId = String(request.data?.customerId || "").trim();
  if (!inquiryId || !customerId) {
    throw new HttpsError(
      "invalid-argument",
      "Inquiry and customer IDs are required.",
    );
  }

  const db = initializeAdmin();
  const inquiryRef = db.doc(`inquiries/${inquiryId}`);
  const customerRef = db.doc(`customers/${customerId}`);
  const uid = request.auth.uid;

  await db.runTransaction(async (transaction) => {
    const [inquiry, customer] = await Promise.all([
      transaction.get(inquiryRef),
      transaction.get(customerRef),
    ]);
    if (!inquiry.exists || !customer.exists ||
        inquiry.get("customerId") !== customerId) {
      throw new HttpsError("not-found", "Inquiry not found.");
    }

    const existingUid = inquiry.get("clientUid");
    if (existingUid && existingUid !== uid) {
      throw new HttpsError(
        "failed-precondition",
        "Inquiry is already linked to another account.",
      );
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.update(inquiryRef, {clientUid: uid, updatedAt: timestamp});
    transaction.update(customerRef, {clientUid: uid, updatedAt: timestamp});
  });

  return {ok: true};
});
