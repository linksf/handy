/**
 * Standalone Square invoice API — no Firebase Functions required.
 *
 * Env:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_LOCATION_ID
 *   SQUARE_ENVIRONMENT=sandbox|production (default sandbox)
 *   GOOGLE_APPLICATION_CREDENTIALS — service account JSON for Firestore + Auth verify
 *   PORT (default 3848)
 *   ALLOWED_ORIGINS — comma-separated CORS origins
 *   SQUARE_WEBHOOK_SIGNATURE_KEY — optional, for POST /webhooks/square
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import admin from "firebase-admin";
import { InvoiceDeliveryMethod, SquareClient, SquareEnvironment } from "square";
import { buildJobInvoiceLines, totalCentsFromLines } from "./jobInvoiceLines.mjs";
import { isOwnerFromDecodedToken } from "./ownerAuth.mjs";

const PORT = Number(process.env.PORT) || 3848;
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,https://handyjob-d3464.web.app,https://handyjob-d3464.firebaseapp.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function getSquareClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set.");
  const env = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
  return new SquareClient({
    token,
    environment: env === "production" ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });
}

function getSquareLocationId() {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID is not set.");
  return id;
}

function dueDateDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapSquareStatus(status) {
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

function mapJobPayStatus(invoiceStatus, amountCents, amountPaidCents) {
  if (invoiceStatus === "paid") {
    return { payStatus: "Paid", amountPaid: amountCents / 100 };
  }
  if (invoiceStatus === "partial" && amountPaidCents) {
    return { payStatus: "Partial", amountPaid: amountPaidCents / 100 };
  }
  return { payStatus: "Unpaid", amountPaid: 0 };
}

async function getOrCreateSquareCustomer(customerId, customer) {
  if (customer.squareCustomerId) return customer.squareCustomerId;

  const phone = (customer.phone || "").trim();
  const email = (customer.email || "").trim();
  const name = (customer.name || "Customer").trim();
  if (!phone && !email) {
    throw new Error("Customer needs a phone number or email before creating a Square invoice.");
  }

  const client = getSquareClient();
  const resp = await client.customers.create({
    idempotencyKey: randomUUID(),
    givenName: name,
    ...(email ? { emailAddress: email } : {}),
    ...(phone ? { phoneNumber: phone } : {}),
  });

  const squareCustomerId = resp.customer?.id;
  if (!squareCustomerId) throw new Error("Square did not return a customer id.");

  await db.collection("customers").doc(customerId).update({ squareCustomerId });
  return squareCustomerId;
}

async function syncInvoiceToFirestore(opts) {
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
  return { firestoreInvoiceId: invoiceRef.id, status };
}

async function applyInvoicePaymentUpdate(squareInvoiceId, squareStatus, amountPaidCents) {
  const snap = await db.collection("invoices")
    .where("squareInvoiceId", "==", squareInvoiceId)
    .limit(1)
    .get();
  if (snap.empty) return;

  const docSnap = snap.docs[0];
  const data = docSnap.data();
  const status = mapSquareStatus(squareStatus);
  const amountCents = Number(data.amountCents) || 0;
  const { payStatus, amountPaid } = mapJobPayStatus(status, amountCents, amountPaidCents);

  const batch = db.batch();
  batch.update(docSnap.ref, {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(amountPaidCents != null ? { amountPaidCents } : {}),
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

async function verifyOwnerBearer(authHeader) {
  const match = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!match) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return isOwnerFromDecodedToken(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function createSquareInvoiceForJob(jobId) {
  const jobSnap = await db.collection("jobs").doc(jobId).get();
  if (!jobSnap.exists) throw new Error("Job not found.");
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
    throw new Error("Add a flat rate, hourly total, or reimbursable line items before creating an invoice.");
  }

  const customerId = String(job.customerId || "");
  if (!customerId) throw new Error("Job has no customer.");
  const customerSnap = await db.collection("customers").doc(customerId).get();
  if (!customerSnap.exists) throw new Error("Customer not found.");
  const customer = customerSnap.data() || {};

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
  if (!orderId) throw new Error("Square did not return an order id.");

  const createResp = await client.invoices.create({
    invoice: {
      locationId,
      orderId,
      primaryRecipient: { customerId: squareCustomerId },
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
    throw new Error("Square did not return a draft invoice.");
  }

  const publishResp = await client.invoices.publish({
    invoiceId: draft.id,
    version: draft.version,
    idempotencyKey: randomUUID(),
  });

  const published = publishResp.invoice;
  const publicUrl = published?.publicUrl || "";
  if (!publicUrl) throw new Error("Square invoice published but no payment link was returned.");

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

function readBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(body);
}

function corsOrigin(req) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0] || "*";
}

function verifySquareWebhookSignature(signatureKey, notificationUrl, rawBody, headerSignature) {
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

const server = http.createServer(async (req, res) => {
  const origin = corsOrigin(req);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && path === "/health") {
    json(res, 200, { ok: true }, origin);
    return;
  }

  if (req.method === "POST" && path === "/api/invoices/create") {
    const owner = await verifyOwnerBearer(req.headers.authorization);
    if (!owner) {
      json(res, 403, { error: "Owner access required." }, origin);
      return;
    }

    let body;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      json(res, 400, { error: "Invalid JSON body." }, origin);
      return;
    }

    const jobId = String(body.jobId || "").trim();
    if (!jobId) {
      json(res, 400, { error: "jobId is required." }, origin);
      return;
    }

    try {
      const data = await createSquareInvoiceForJob(jobId);
      json(res, 200, data, origin);
    } catch (err) {
      console.error("create invoice", err);
      json(res, 500, { error: err?.message || "Could not create invoice." }, origin);
    }
    return;
  }

  if (req.method === "POST" && path === "/webhooks/square") {
    let rawBody;
    try {
      rawBody = (await readBody(req)).toString("utf8");
    } catch {
      res.writeHead(413).end();
      return;
    }

    const sigKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (sigKey) {
      const headerSig = String(req.headers["x-square-hmacsha256-signature"] || "");
      const notificationUrl = `https://${req.headers.host}${path}`;
      if (!headerSig || !verifySquareWebhookSignature(sigKey, notificationUrl, rawBody, headerSig)) {
        res.writeHead(401).end("Invalid signature");
        return;
      }
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.writeHead(400).end("Invalid JSON");
      return;
    }

    const type = String(payload.type || "");
    const data = payload.data;
    const obj = data?.object;
    const invoice = obj?.invoice;
    const squareInvoiceId = String(invoice?.id || data?.id || "");

    if (squareInvoiceId && (type.startsWith("invoice.") || type === "invoice.payment_made")) {
      try {
        await applyInvoicePaymentUpdate(squareInvoiceId, String(invoice?.status || ""));
      } catch (err) {
        console.error("webhook handler", err);
        res.writeHead(500).end("Handler error");
        return;
      }
    }

    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "Not found" }, origin);
});

server.listen(PORT, () => {
  console.log(`Invoice API listening on http://localhost:${PORT}`);
  console.log(`  POST /api/invoices/create`);
  console.log(`  POST /webhooks/square (optional)`);
  console.log(`  GET  /health`);
});
