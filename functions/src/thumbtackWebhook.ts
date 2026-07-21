/* eslint-disable require-jsdoc, valid-jsdoc */
import {timingSafeEqual} from "crypto";
import * as admin from "firebase-admin";
import {onRequest} from "firebase-functions/https";
import {defineSecret, defineString} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {generateOpaqueCustomerId, isOpaqueCustomerId} from "@handy/shared";
import {generateInviteToken, normalizePhoneDigits} from "./leadInvite";

const thumbtackWebhookSecret = defineSecret("THUMBTACK_WEBHOOK_SECRET");
const thumbtackWebhookUser = defineString("THUMBTACK_WEBHOOK_USER", {
  default: "handyjob",
});
const clientAppOrigin = defineString("CLIENT_APP_ORIGIN", {
  default: "https://handyjob-d3464.web.app",
});

function leadInviteUrl(token: string): string {
  const base = clientAppOrigin.value().replace(/\/$/, "");
  return `${base}/book/lead/${token}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Thumbtack may POST the negotiation directly or wrap it in
 * { data } / { negotiation }.
 */
export function normalizeThumbtackPayload(
  body: unknown,
): Record<string, unknown> {
  const root = asRecord(body);
  if (!root) return {};

  const hasLeadShape =
    Boolean(root.negotiationID || root.leadID) ||
    (Boolean(root.customer) && Boolean(root.request));

  if (hasLeadShape) return root;

  for (const key of ["negotiation", "payload", "lead"]) {
    const nested = asRecord(root[key]);
    if (nested) return normalizeThumbtackPayload(nested);
  }

  const data = asRecord(root.data);
  if (data) return normalizeThumbtackPayload(data);

  return root;
}

/**
 * Best-effort id for deduping retries (Thumbtack / Zapier shapes vary).
 */
export function extractExternalLeadId(body: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  const root = asRecord(body);
  if (!root) return null;
  const keys = [
    "negotiationID", "negotiationId", "negotiation_id",
    "leadID", "leadId", "lead_id",
    "requestID", "requestId", "request_id",
    "eventID", "eventId", "event_id",
    "deliveryID", "deliveryId",
  ];
  for (const k of keys) {
    const v = root[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof root.id === "string" && root.id.trim()) return root.id.trim();
  const data = asRecord(root.data);
  if (data) return extractExternalLeadId(data, depth + 1);
  const negotiation = asRecord(root.negotiation);
  if (negotiation) return extractExternalLeadId(negotiation, depth + 1);
  const request = asRecord(root.request);
  if (request) return extractExternalLeadId(request, depth + 1);
  return null;
}

function formatLocation(loc: Record<string, unknown> | null): string {
  if (!loc) return "";
  const street = [str(loc.address1), str(loc.address2)]
    .filter(Boolean)
    .join(", ");
  const city = str(loc.city);
  const state = str(loc.state);
  const zip = str(loc.zipCode) || str(loc.zip);
  const cityLine = [city, state, zip].filter(Boolean).join(", ");
  if (street && cityLine) return `${street}, ${cityLine}`;
  if (street) return street;
  return cityLine;
}

function parseMoneyAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

function detailAnswer(details: unknown, questionMatch: RegExp): string {
  if (!Array.isArray(details)) return "";
  for (const row of details) {
    const o = asRecord(row);
    if (!o) continue;
    const q = str(o.question);
    if (questionMatch.test(q)) return str(o.answer).trim();
  }
  return "";
}

/** Client-relevant Q&A only — skip duplicates and admin-only rows. */
function formatClientDetails(
  details: unknown,
  opts: {description: string; categoryName: string; address: string},
): string {
  if (!Array.isArray(details)) return "";
  const skip = [
    /^photos$/i,
    /^category$/i,
    /^zip code$/i,
  ];
  const lines: string[] = [];
  for (const row of details) {
    const o = asRecord(row);
    if (!o) continue;
    const q = str(o.question).trim();
    const a = str(o.answer).trim();
    if (!q || !a) continue;
    if (skip.some((re) => re.test(q))) continue;
    if (/^anything else$/i.test(q) && a === opts.description.trim()) continue;
    if (/^category$/i.test(q) && a === opts.categoryName) continue;
    if (/^zip code$/i.test(q) && opts.address.includes(a)) continue;
    lines.push(`${q}: ${a}`);
  }
  return lines.join("\n");
}

function formatClientAttachments(attachments: unknown): string {
  if (!Array.isArray(attachments) || attachments.length === 0) return "";
  const lines: string[] = [];
  for (const row of attachments) {
    const o = asRecord(row);
    if (!o) continue;
    const url = str(o.url);
    const desc = str(o.description);
    if (desc && url) lines.push(`${desc}\n${url}`);
    else if (url) lines.push(url);
    else if (desc) lines.push(desc);
  }
  return lines.join("\n\n");
}

export interface ParsedThumbtackExpense {
  id: string;
  type: string;
  name: string;
  amount: string;
  datePaid: string;
  reimbursable: boolean;
}

export interface ParsedThumbtackRevenue {
  price: string;
  hourlyRate: string;
  hours: string;
}

/** Map Thumbtack estimate to flat rate and/or hourly fields. */
export function parseThumbtackRevenue(
  estimate: Record<string, unknown> | null,
  details: unknown,
): ParsedThumbtackRevenue {
  const out: ParsedThumbtackRevenue = {price: "", hourlyRate: "", hours: ""};
  if (!estimate) return out;

  const type = str(estimate.type).toLowerCase();
  const unitName = str(estimate.unitName).toLowerCase();
  const totalRaw = str(estimate.total);
  const pricePerUnit = parseMoneyAmount(str(estimate.pricePerUnit));
  const totalAmount = parseMoneyAmount(totalRaw);
  const unitQty = Number(estimate.unitQuantity) || 0;

  const isHourly =
    type.includes("unit") ||
    type.includes("hour") ||
    unitName.includes("hour") ||
    /\/\s*hr\b|\/hour/i.test(totalRaw);

  const isFlat =
    type.includes("fixed") ||
    type.includes("flat") ||
    type.includes("total") ||
    (!isHourly && totalAmount != null && !/\/\s*hr\b|\/hour/i.test(totalRaw));

  if (isHourly && pricePerUnit != null) {
    out.hourlyRate = pricePerUnit.toFixed(2);
    if (unitQty > 0) {
      out.hours = String(unitQty);
    } else {
      const estHours = detailAnswer(details, /estimated hours/i);
      const m = estHours.match(/(\d+(?:\.\d+)?)/);
      if (m) out.hours = m[1];
    }
  } else if (isFlat) {
    const flat = totalAmount ?? pricePerUnit;
    if (flat != null) out.price = flat.toFixed(2);
  } else if (pricePerUnit != null) {
    out.hourlyRate = pricePerUnit.toFixed(2);
  }

  return out;
}

function buildLeadExpense(leadPriceRaw: string): ParsedThumbtackExpense | null {
  const amount = parseMoneyAmount(leadPriceRaw);
  if (amount == null || amount <= 0) return null;
  return {
    id: "thumbtack-lead-fee",
    type: "Referral Fee",
    name: "Thumbtack lead fee",
    amount: amount.toFixed(2),
    datePaid: "",
    reimbursable: false,
  };
}

export interface ParsedThumbtackLead {
  name: string;
  phone: string;
  email: string;
  thumbtackCustomerId: string;
  address: string;
  /** Admin-only customer notes. */
  customerNotes: string;
  jobTitle: string;
  /** Shown to client (lead invite / booking flow). */
  clientJobNotes: string;
  /** Admin job notes field only. */
  adminJobNotes: string;
  price: string;
  hourlyRate: string;
  hours: string;
  expenses: ParsedThumbtackExpense[];
  externalId: string | null;
  /** @deprecated use clientJobNotes */
  jobNotes: string;
}

type ThumbtackCustomerFields = Pick<
  ParsedThumbtackLead,
  | "name"
  | "phone"
  | "email"
  | "address"
  | "customerNotes"
  | "thumbtackCustomerId"
>;

/** Build a customer merge without resetting ownership or lifecycle fields. */
export function buildThumbtackCustomerWritePayload(
  parsed: ThumbtackCustomerFields,
  token: string,
  createdAt: unknown,
  exists: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: parsed.name,
    phone: parsed.phone,
    email: parsed.email,
    address: parsed.address,
    notes: parsed.customerNotes,
    leadInviteToken: token,
  };
  if (isOpaqueCustomerId(parsed.thumbtackCustomerId)) {
    payload.thumbtackCustomerId = parsed.thumbtackCustomerId;
  }
  if (!exists) {
    payload.status = "preliminary";
    payload.clientUid = null;
    payload.createdAt = createdAt;
  }
  return payload;
}

/** Use Thumbtack's opaque ID when valid, otherwise generate a safe local ID. */
export function resolveThumbtackCustomerId(
  thumbtackCustomerId: string,
): string {
  return isOpaqueCustomerId(thumbtackCustomerId) ?
    thumbtackCustomerId :
    generateOpaqueCustomerId();
}

export function parseThumbtackLeadPayload(body: unknown): ParsedThumbtackLead {
  const root = normalizeThumbtackPayload(body);
  const customer = asRecord(root.customer);
  const request = asRecord(root.request);
  const business = asRecord(root.business);
  const category =
    asRecord(request?.category) ||
    asRecord(root.category);
  const categoryName = str(category?.name);

  const name = formatCustomerName(customer, root).trim();

  const phone = (
    str(customer?.phone) ||
    str(root.phone) ||
    str(root.customerPhone) ||
    str(root.phoneNumber)
  ).trim();

  const email = (
    str(customer?.email) ||
    str(root.email) ||
    ""
  ).trim();

  const thumbtackCustomerId = (
    str(customer?.customerID) ||
    str(customer?.customerId) ||
    str(root.customerID) ||
    ""
  ).trim();

  const loc =
    asRecord(request?.location) ||
    asRecord(customer?.location) ||
    asRecord(root.location);

  const address = formatLocation(loc);

  const titleRaw =
    str(request?.title) ||
    str(root.title) ||
    str(root.jobTitle) ||
    str(root.subject) ||
    categoryName ||
    "";
  const jobTitle = titleRaw.trim() || "Thumbtack job";

  const description =
    str(request?.description) ||
    str(root.description) ||
    str(root.message) ||
    "";

  const details = request?.details ?? root.details;
  const clientDetails = formatClientDetails(details, {
    description,
    categoryName,
    address,
  });
  const clientAttachments = formatClientAttachments(request?.attachments);
  const revenue = parseThumbtackRevenue(asRecord(root.estimate), details);
  const leadExpense = buildLeadExpense(str(root.leadPrice));

  const clientParts = [
    description.trim(),
    clientDetails && clientDetails,
    clientAttachments && `Photos:\n${clientAttachments}`,
  ].filter(Boolean);
  const clientJobNotes =
    clientParts.join("\n\n") ||
    "Imported from Thumbtack (no extra details).";

  const proposedTimes = formatProposedTimes(request?.proposedTimes);
  const statusLine = str(root.status);
  const chargeState = str(root.chargeState);
  const accessCode = str(business?.accessCode);
  const estimateSummary = formatEstimate(asRecord(root.estimate));

  const adminParts = [
    "Imported from Thumbtack webhook.",
    proposedTimes && `Customer proposed times:\n${proposedTimes}`,
    statusLine && `Thumbtack status: ${statusLine}`,
    chargeState && `Lead charge: ${chargeState}`,
    estimateSummary &&
      (revenue.price || revenue.hourlyRate) &&
      `Estimate on file: ${estimateSummary} (mapped to job pricing fields)`,
    str(root.leadPrice) &&
      !leadExpense &&
      `Lead price pending: ${str(root.leadPrice)}`,
  ].filter(Boolean);
  const adminJobNotes = adminParts.join("\n\n");

  const customerNoteParts = [
    "Lead source: Thumbtack.",
    accessCode && `Thumbtack access code: ${accessCode}`,
  ].filter(Boolean);

  return {
    name,
    phone,
    email,
    thumbtackCustomerId,
    address,
    customerNotes: customerNoteParts.join(" "),
    jobTitle,
    clientJobNotes,
    adminJobNotes,
    price: revenue.price,
    hourlyRate: revenue.hourlyRate,
    hours: revenue.hours,
    expenses: leadExpense ? [leadExpense] : [],
    externalId: extractExternalLeadId(root),
    jobNotes: clientJobNotes,
  };
}

function formatProposedTimes(times: unknown): string {
  if (!Array.isArray(times) || times.length === 0) return "";
  const lines: string[] = [];
  for (const row of times) {
    const o = asRecord(row);
    if (!o) continue;
    const start = str(o.start);
    const end = str(o.end);
    if (start || end) lines.push(`${start}${end ? ` – ${end}` : ""}`.trim());
  }
  return lines.join("\n");
}

function formatEstimate(estimate: Record<string, unknown> | null): string {
  if (!estimate) return "";
  const total = str(estimate.total);
  if (total) return total;
  const type = str(estimate.type);
  const price = str(estimate.pricePerUnit);
  const unit = str(estimate.unitName);
  if (type && price) {
    return `${type}: $${price}${unit ? `/${unit}` : ""}`;
  }
  return "";
}

function formatCustomerName(
  customer: Record<string, unknown> | null,
  root: Record<string, unknown>,
): string {
  const display = str(customer?.displayName);
  if (display) return display;
  const full = str(customer?.name) || str(root.customerName);
  if (full) return full;
  const combined = [str(customer?.firstName), str(customer?.lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (combined) return combined;
  return str(root.name) || "Thumbtack lead";
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function parseBasicAuth(
  authHeader: string,
): {user: string; pass: string} | null {
  const m = /^Basic\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return {user: decoded.slice(0, idx), pass: decoded.slice(idx + 1)};
  } catch {
    return null;
  }
}

function isAuthorized(req: {
  get: (name: string) => string | undefined;
}, expectedSecret: string, expectedUser: string): boolean {
  const secret = expectedSecret.trim();
  const user = expectedUser.trim();

  const headerSecret =
    req.get("x-thumbtack-webhook-secret") ||
    req.get("x-webhook-secret") ||
    req.get("x-webhook-token");
  if (headerSecret && safeEqual(headerSecret.trim(), secret)) return true;

  const auth = req.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer && safeEqual(bearer[1].trim(), secret)) return true;

  const basic = parseBasicAuth(auth);
  if (basic && safeEqual(basic.pass.trim(), secret)) {
    if (!basic.user.trim() || !user || safeEqual(basic.user.trim(), user)) {
      return true;
    }
    // Password matches — accept even if username differs (Thumbtack config drift).
    logger.warn("Thumbtack webhook: password ok, username mismatch", {
      receivedUser: basic.user.trim(),
      expectedUser: user,
    });
    return true;
  }

  return false;
}

function logAuthFailure(req: {
  get: (name: string) => string | undefined;
}): void {
  const auth = req.get("authorization") || "";
  const basic = parseBasicAuth(auth);
  logger.warn("Thumbtack webhook unauthorized", {
    hasAuthorization: Boolean(auth),
    scheme: auth ? auth.split(/\s+/)[0] : "none",
    basicUsername: basic?.user?.trim() || null,
    hasCustomSecretHeader: Boolean(
      req.get("x-thumbtack-webhook-secret") ||
      req.get("x-webhook-secret") ||
      req.get("x-webhook-token"),
    ),
  });
}

export const thumbtackWebhook = onRequest(
  {
    secrets: [thumbtackWebhookSecret],
    cors: false,
    invoker: "public",
    maxInstances: 10,
  },
  async (req, res) => {
    if (req.method === "GET") {
      res.status(200).json({
        ok: true,
        hint: "POST Thumbtack NegotiationCreatedV4 JSON to this URL.",
        auth: [
          "Basic auth (username + THUMBTACK_WEBHOOK_SECRET password)",
          "x-thumbtack-webhook-secret header",
          "Authorization: Bearer <secret>",
        ],
      });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const expectedSecret = thumbtackWebhookSecret.value();
    if (!expectedSecret) {
      logger.error("THUMBTACK_WEBHOOK_SECRET is not configured");
      res.status(500).json({ok: false, error: "server_misconfigured"});
      return;
    }

    const expectedUser = thumbtackWebhookUser.value() || "handyjob";
    if (!isAuthorized(req, expectedSecret, expectedUser)) {
      logAuthFailure(req);
      res.status(401).json({ok: false, error: "unauthorized"});
      return;
    }

    let body: unknown = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        res.status(400).json({ok: false, error: "invalid_json"});
        return;
      }
    }
    if (body === undefined || body === null || typeof body !== "object") {
      res.status(400).json({ok: false, error: "expected_json_object"});
      return;
    }

    if (!admin.apps.length) {
      admin.initializeApp();
    }
    const db = admin.firestore();

    try {
      const parsed = parseThumbtackLeadPayload(body);

      if (parsed.externalId) {
        const dup = await db.collection("jobs")
          .where("sourceThumbtackLeadId", "==", parsed.externalId)
          .limit(1)
          .get();
        if (!dup.empty) {
          const doc = dup.docs[0];
          const jobId = doc.id;
          const customerId = str(doc.get("customerId"));
          const inviteToken = str(doc.get("leadInviteToken"));
          logger.info("Thumbtack webhook duplicate lead id", {
            jobId,
            customerId,
            externalId: parsed.externalId,
          });
          res.status(200).json({
            ok: true,
            duplicate: true,
            customerId: customerId || null,
            jobId,
            inviteUrl: inviteToken ? leadInviteUrl(inviteToken) : null,
          });
          return;
        }
      }

      const token = generateInviteToken();
      const phoneNormalized = normalizePhoneDigits(parsed.phone);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const hasValidThumbtackCustomerId =
        isOpaqueCustomerId(parsed.thumbtackCustomerId);
      const customerId = resolveThumbtackCustomerId(
        parsed.thumbtackCustomerId,
      );
      if (!hasValidThumbtackCustomerId) {
        logger.warn(
          "Thumbtack webhook generated customer ID for invalid source ID",
          {
            externalId: parsed.externalId,
            hasThumbtackCustomerId: Boolean(parsed.thumbtackCustomerId),
          },
        );
      }

      const batch = db.batch();
      const custRef = db.collection("customers")
        .doc(customerId);
      const custSnapshot = await custRef.get();
      const customerPayload = buildThumbtackCustomerWritePayload(
        parsed,
        token,
        now,
        custSnapshot.exists,
      );
      batch.set(custRef, customerPayload, {merge: true});

      const jobRef = db.collection("jobs").doc();
      const jobPayload: Record<string, unknown> = {
        title: parsed.jobTitle,
        customerId: custRef.id,
        date: "",
        status: "Draft",
        price: parsed.price,
        hourlyRate: parsed.hourlyRate,
        hours: parsed.hours,
        notes: parsed.adminJobNotes,
        tasks: [],
        expenses: parsed.expenses,
        payStatus: "Unpaid",
        amountPaid: 0,
        source: "thumbtack",
        leadInviteToken: token,
        bookingClientUid: null,
      };
      if (parsed.externalId) {
        jobPayload.sourceThumbtackLeadId = parsed.externalId;
      }
      batch.set(jobRef, jobPayload);

      const inviteRef = db.collection("leadInvites").doc(token);
      const invitePayload: Record<string, unknown> = {
        token,
        customerId: custRef.id,
        jobId: jobRef.id,
        name: parsed.name,
        phone: parsed.phone,
        phoneNormalized,
        email: parsed.email,
        address: parsed.address,
        jobTitle: parsed.jobTitle,
        jobNotes: parsed.clientJobNotes,
        source: "thumbtack",
        sourceThumbtackLeadId: parsed.externalId || null,
        status: "open",
        clientUid: null,
        bookingRequestId: null,
        createdAt: now,
        updatedAt: now,
      };
      if (hasValidThumbtackCustomerId) {
        invitePayload.thumbtackCustomerId = parsed.thumbtackCustomerId;
      }
      batch.set(inviteRef, invitePayload);

      await batch.commit();

      const inviteUrl = leadInviteUrl(token);
      logger.info("Thumbtack webhook created lead invite", {
        customerId: custRef.id,
        jobId: jobRef.id,
        inviteToken: token,
        externalId: parsed.externalId,
        customerName: parsed.name,
        jobTitle: parsed.jobTitle,
      });
      res.status(200).json({
        ok: true,
        customerId: custRef.id,
        jobId: jobRef.id,
        inviteToken: token,
        inviteUrl,
      });
    } catch (err) {
      logger.error("Thumbtack webhook failed", err);
      res.status(500).json({ok: false, error: "internal"});
    }
  }
);
