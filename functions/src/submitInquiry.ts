/* eslint-disable require-jsdoc, valid-jsdoc */
import * as admin from "firebase-admin";
import {generateOpaqueCustomerId} from "@handy/shared";
import {HttpsError, onCall} from "firebase-functions/v2/https";

const stringFieldLimits = {
  phone: 500,
  email: 500,
  address: 1000,
  preferredTiming: 500,
  howFoundUs: 500,
  propertyType: 500,
  indoorOutdoor: 500,
  urgency: 500,
  estimatedHours: 500,
  accessNotes: 1000,
  materials: 1000,
  dimensionsNotes: 1000,
  installOrPickup: 500,
  finishNotes: 1000,
  deadline: 500,
} as const;

const stringFields = Object.keys(stringFieldLimits) as Array<
  keyof typeof stringFieldLimits
>;

export interface ValidatedInquiryInput {
  category: "handyman" | "fabrication";
  name: string;
  description: string;
  optionalFields: Record<string, string>;
  photoUrls: string[];
}

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
  if (value.length > 10) {
    throw new HttpsError(
      "invalid-argument",
      "Photo URLs may contain at most 10 items.",
    );
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new HttpsError(
        "invalid-argument",
        "Each photo URL must be a string.",
      );
    }
    const url = item.trim();
    if (url.length > 2000) {
      throw new HttpsError(
        "invalid-argument",
        "Photo URL maximum length is 2000 characters.",
      );
    }
    return url;
  }).filter(Boolean);
}

function requireWithinLimit(
  field: string,
  value: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `${field} maximum length is ${maxLength} characters.`,
    );
  }
}

/** Validate and normalize untrusted guest inquiry input. */
export function validateInquiryInput(
  data: Record<string, unknown>,
): ValidatedInquiryInput {
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
  requireWithinLimit("Name", name, 120);
  requireWithinLimit("Description", description, 4000);

  const optionalFields = submittedStringFields(data);
  for (const field of stringFields) {
    requireWithinLimit(field, optionalFields[field], stringFieldLimits[field]);
  }

  return {
    category,
    name,
    description,
    optionalFields,
    photoUrls: submittedPhotoUrls(data.photoUrls),
  };
}

/**
 * Accepts a guest inquiry and atomically creates its preliminary customer.
 */
export const submitInquiry = onCall({invoker: "public"}, async (request) => {
  const data = (request.data || {}) as Record<string, unknown>;
  const {
    category,
    name,
    description,
    optionalFields,
    photoUrls,
  } = validateInquiryInput(data);

  const db = initializeAdmin();
  const customerId = generateOpaqueCustomerId();
  const inquiryRef = db.collection("inquiries").doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
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
    photoUrls,
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
