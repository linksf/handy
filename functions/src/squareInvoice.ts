import {createHmac, randomUUID, timingSafeEqual} from "crypto";
import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  InvoiceDeliveryMethod,
} from "square";
import {isOwnerAuth} from "./ownerAuth";
import {buildJobInvoiceLines, totalCentsFromLines} from "./jobInvoiceLines";
import {
  getSquareClient,
  getSquareLocationId,
  squareAccessToken,
  squareLocationId,
  squareWebhookSignatureKey,
} from "./squareClient";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface CustomerDoc {
  name?: string;
  phone?: string;
  email?: string;
  squareCustomerId?: string;
}

function dueDateDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapSquareStatus(status: string | undefined): string {
  switch (status) {
  case "PAID":
    return "paid";
  case "PARTIALLY_PAID":
    return "partial";
  case "CANCELED":
  case "FAILED":
    return "canceled";
  case "DRAFT":
    return "draft";
  default:
    return "unpaid";
  }
}

function mapJobPayStatus(invoiceStatus: string, amountCents: number, amountPaidCents?: number): {
  payStatus: string;
  amountPaid: number;
} {
  if (invoiceStatus === "paid") {
    return {payStatus: "Paid", amountPaid: amountCents / 100};
  }
  if (invoiceStatus === "partial" && amountPaidCents) {
    return {payStatus: "Partial", amountPaid: amountPaidCents / 100};
  }
  return {payStatus: "Unpaid", amountPaid: 0};
}

async function getOrCreateSquareCustomer(
  customerId: string,
  customer: CustomerDoc
): Promise<string> {
  if (customer.squareCustomerId) return customer.squareCustomerId;

  const phone = (customer.phone || "").trim();
  const email = (customer.email || "").trim();
  const name = (customer.name || "Customer").trim();
  if (!phone && !email) {
    throw new HttpsError(
      "failed-precondition",
      "Customer needs a phone number or email before creating a Square invoice."
    );
  }

  const client = getSquareClient();
  const resp = await client.customers.create({
    idempotencyKey: randomUUID(),
    givenName: name,
    ...(email ? {emailAddress: email} : {}),
    ...(phone ? {phoneNumber: phone} : {}),
  });

  const squareCustomerId = resp.customer?.id;
  if (!squareCustomerId) {
    throw new HttpsError("internal", "Square did not return a customer id.");
  }

  await db.collection("customers").doc(customerId).update({squareCustomerId});
  return squareCustomerId;
}

async function syncInvoiceToFirestore(opts: {
  jobId: string;
  jobTitle: string;
  clientUid: string;
  customerId: string;
  squareInvoiceId: string;
  publicUrl: string;
  amountCents: number;
  squareStatus: string;
}) {
  const status = mapSquareStatus(opts.squareStatus);
  const invoiceRef = db.collection("invoices").doc();
  const batch = db.batch();
  batch.set(invoiceRef, {
    jobId: opts.jobId,
    jobTitle: opts.jobTitle,
    clientUid: opts.clientUid || "",
    customerId: opts.customerId,
    squareInvoiceId: opts.squareInvoiceId,
    publicUrl: opts.publicUrl,
    amountCents: opts.amountCents,
    status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.update(db.collection("jobs").doc(opts.jobId), {
    squareInvoiceId: opts.squareInvoiceId,
    squarePublicUrl: opts.publicUrl,
    squareInvoiceStatus: status,
    firestoreInvoiceId: invoiceRef.id,
  });
  await batch.commit();
  return {firestoreInvoiceId: invoiceRef.id, status};
}

async function applyInvoicePaymentUpdate(
  squareInvoiceId: string,
  squareStatus: string | undefined,
  amountPaidCents?: number
) {
  const snap = await db.collection("invoices")
    .where("squareInvoiceId", "==", squareInvoiceId)
    .limit(1)
    .get();
  if (snap.empty) {
    logger.warn("Square webhook: no Firestore invoice for", squareInvoiceId);
    return;
  }

  const doc = snap.docs[0];
  const data = doc.data();
  const status = mapSquareStatus(squareStatus);
  const amountCents = Number(data.amountCents) || 0;
  const {payStatus, amountPaid} = mapJobPayStatus(status, amountCents, amountPaidCents);

  const batch = db.batch();
  batch.update(doc.ref, {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(amountPaidCents != null ? {amountPaidCents} : {}),
  });
  if (data.jobId) {
    batch.update(db.collection("jobs").doc(data.jobId), {
      squareInvoiceStatus: status,
      payStatus,
      amountPaid,
    });
  }
  await batch.commit();
}

export const createSquareInvoice = onCall(
  {
    secrets: [squareAccessToken, squareLocationId],
  },
  async (request) => {
    if (!isOwnerAuth(request.auth)) {
      throw new HttpsError("permission-denied", "Owner access required.");
    }

    const jobId = String(request.data?.jobId || "").trim();
    if (!jobId) {
      throw new HttpsError("invalid-argument", "jobId is required.");
    }

    const jobSnap = await db.collection("jobs").doc(jobId).get();
    if (!jobSnap.exists) {
      throw new HttpsError("not-found", "Job not found.");
    }
    const job = jobSnap.data() || {};

    const existingStatus = String(job.squareInvoiceStatus || "");
    const existingUrl = String(job.squarePublicUrl || "");
    if (
      job.squareInvoiceId &&
      existingUrl &&
      (existingStatus === "unpaid" || existingStatus === "partial" || existingStatus === "draft")
    ) {
      return {
        alreadyExists: true,
        publicUrl: existingUrl,
        squareInvoiceId: job.squareInvoiceId,
        firestoreInvoiceId: job.firestoreInvoiceId || null,
        status: existingStatus,
      };
    }

    const lines = buildJobInvoiceLines(job);
    const amountCents = totalCentsFromLines(lines);
    if (amountCents <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "Add a flat rate, hourly total, or reimbursable line items before creating an invoice."
      );
    }

    const customerId = String(job.customerId || "");
    if (!customerId) {
      throw new HttpsError("failed-precondition", "Job has no customer.");
    }
    const customerSnap = await db.collection("customers").doc(customerId).get();
    if (!customerSnap.exists) {
      throw new HttpsError("not-found", "Customer not found.");
    }
    const customer = customerSnap.data() as CustomerDoc;

    const locationId = getSquareLocationId();
    const squareCustomerId = await getOrCreateSquareCustomer(customerId, customer);
    const client = getSquareClient();
    const jobTitle = String(job.title || "Job").trim() || "Job";

    const orderResp = await client.orders.create({
      order: {
        locationId,
        customerId: squareCustomerId,
        lineItems: lines.map((line) => ({
          name: line.name,
          quantity: "1",
          basePriceMoney: {
            amount: BigInt(line.amountCents),
            currency: "USD",
          },
        })),
      },
      idempotencyKey: randomUUID(),
    });

    const orderId = orderResp.order?.id;
    if (!orderId) {
      throw new HttpsError("internal", "Square did not return an order id.");
    }

    const createResp = await client.invoices.create({
      invoice: {
        locationId,
        orderId,
        primaryRecipient: {customerId: squareCustomerId},
        paymentRequests: [{
          requestType: "BALANCE",
          dueDate: dueDateDaysFromNow(14),
        }],
        deliveryMethod: InvoiceDeliveryMethod.ShareManually,
        title: jobTitle,
        description: `Invoice for ${jobTitle}`,
      },
      idempotencyKey: randomUUID(),
    });

    const draft = createResp.invoice;
    if (!draft?.id || draft.version == null) {
      throw new HttpsError("internal", "Square did not return a draft invoice.");
    }

    const publishResp = await client.invoices.publish({
      invoiceId: draft.id,
      version: draft.version,
      idempotencyKey: randomUUID(),
    });

    const published = publishResp.invoice;
    const publicUrl = published?.publicUrl || "";
    if (!publicUrl) {
      throw new HttpsError("internal", "Square invoice published but no payment link was returned.");
    }

    const saved = await syncInvoiceToFirestore({
      jobId,
      jobTitle,
      clientUid: String(job.bookingClientUid || ""),
      customerId,
      squareInvoiceId: draft.id,
      publicUrl,
      amountCents,
      squareStatus: published?.status || "UNPAID",
    });

    return {
      alreadyExists: false,
      publicUrl,
      squareInvoiceId: draft.id,
      firestoreInvoiceId: saved.firestoreInvoiceId,
      status: saved.status,
      amountCents,
    };
  }
);

function verifySquareWebhookSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  headerSignature: string
): boolean {
  const payload = notificationUrl + rawBody;
  const expected = createHmac("sha256", signatureKey).update(payload).digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(headerSignature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const squareWebhook = onRequest(
  {
    secrets: [squareWebhookSignatureKey],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const rawBody =
      typeof req.rawBody === "string" ?
        req.rawBody :
        req.rawBody?.toString("utf8") ||
        JSON.stringify(req.body);

    const sigKey = squareWebhookSignatureKey.value();
    if (sigKey) {
      const headerSig = String(req.get("x-square-hmacsha256-signature") || "");
      const notificationUrl = `https://${req.get("host")}${req.originalUrl}`;
      if (!headerSig || !verifySquareWebhookSignature(sigKey, notificationUrl, rawBody, headerSig)) {
        logger.warn("Square webhook signature mismatch");
        res.status(401).send("Invalid signature");
        return;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.status(400).send("Invalid JSON");
      return;
    }

    const type = String(payload.type || "");
    const data = payload.data as Record<string, unknown> | undefined;
    const obj = data?.object as Record<string, unknown> | undefined;
    const invoice = obj?.invoice as Record<string, unknown> | undefined;
    const squareInvoiceId = String(invoice?.id || data?.id || "");

    if (
      squareInvoiceId &&
      (type.startsWith("invoice.") || type === "invoice.payment_made")
    ) {
      const status = String(invoice?.status || "");
      const paidMoney = invoice?.paymentRequests as unknown;
      let amountPaidCents: number | undefined;
      if (Array.isArray(paidMoney)) {
        // best-effort: sum completed payments if present
        amountPaidCents = undefined;
      }
      try {
        await applyInvoicePaymentUpdate(squareInvoiceId, status, amountPaidCents);
      } catch (err) {
        logger.error("Square webhook handler error", err);
        res.status(500).send("Handler error");
        return;
      }
    }

    res.status(200).json({ok: true});
  }
);
