#!/usr/bin/env node
/**
 * Register or manage a Thumbtack V4 webhook for NegotiationCreatedV4 (new leads).
 *
 * Prerequisites:
 * - Thumbtack Partner API access (OAuth access token with webhooks.write)
 * - Your Firebase function URL deployed (thumbtackWebhook)
 *
 * Env:
 *   THUMBTACK_ACCESS_TOKEN   — Bearer token from OAuth
 *   THUMBTACK_BUSINESS_ID    — e.g. 567536553635102723
 *   THUMBTACK_WEBHOOK_URL    — https://thumbtackwebhook-k7twfhrlda-uc.a.run.app
 *   THUMBTACK_WEBHOOK_USER   — Basic auth username (default: handyjob)
 *   THUMBTACK_WEBHOOK_SECRET — Basic auth password (same value as Firebase secret)
 *   THUMBTACK_API_BASE       — optional, default https://api.thumbtack.com/v4
 *
 * Usage:
 *   node scripts/thumbtackWebhookSetup.mjs list
 *   node scripts/thumbtackWebhookSetup.mjs create
 *   node scripts/thumbtackWebhookSetup.mjs enable <webhookID>
 *   node scripts/thumbtackWebhookSetup.mjs update-auth <webhookID>
 */
const API_BASE = (process.env.THUMBTACK_API_BASE || "https://api.thumbtack.com/v4").replace(/\/$/, "");
const token = (process.env.THUMBTACK_ACCESS_TOKEN || "").trim();
const businessId = (process.env.THUMBTACK_BUSINESS_ID || "").trim();
const webhookUrl = (process.env.THUMBTACK_WEBHOOK_URL || "").trim();
const webhookUser = (process.env.THUMBTACK_WEBHOOK_USER || "handyjob").trim();
const webhookSecret = (process.env.THUMBTACK_WEBHOOK_SECRET || "").trim();
const cmd = (process.argv[2] || "list").toLowerCase();
const webhookId = (process.argv[3] || "").trim();

function usage() {
  console.error(`Usage:
  node scripts/thumbtackWebhookSetup.mjs list
  node scripts/thumbtackWebhookSetup.mjs create
  node scripts/thumbtackWebhookSetup.mjs enable <webhookID>
  node scripts/thumbtackWebhookSetup.mjs update-auth <webhookID>`);
  process.exit(1);
}

function requireEnv() {
  if (!token) {
    console.error("Missing THUMBTACK_ACCESS_TOKEN");
    process.exit(1);
  }
  if (!businessId) {
    console.error("Missing THUMBTACK_BUSINESS_ID");
    process.exit(1);
  }
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

async function listWebhooks() {
  requireEnv();
  const data = await api(`/businesses/${businessId}/webhooks`);
  console.log(JSON.stringify(data, null, 2));
}

async function createWebhook() {
  requireEnv();
  if (!webhookUrl) {
    console.error("Missing THUMBTACK_WEBHOOK_URL");
    process.exit(1);
  }
  if (!webhookSecret) {
    console.error("Missing THUMBTACK_WEBHOOK_SECRET");
    process.exit(1);
  }
  const payload = {
    webhookURL: webhookUrl,
    eventTypes: ["NegotiationCreatedV4"],
    enabled: true,
    auth: {
      username: webhookUser,
      password: webhookSecret,
    },
  };
  console.log("Creating webhook with:", {
    webhookURL: webhookUrl,
    eventTypes: payload.eventTypes,
    auth: { username: webhookUser, password: "(hidden)" },
  });
  const data = await api(`/businesses/${businessId}/webhooks`, {
    method: "POST",
    body: payload,
  });
  console.log("Created:");
  console.log(JSON.stringify(data, null, 2));
}

async function enableWebhook() {
  requireEnv();
  if (!webhookId) usage();
  const data = await api(`/businesses/${businessId}/webhooks/${webhookId}`, {
    method: "PUT",
    body: { enabled: true },
  });
  console.log(JSON.stringify(data, null, 2));
}

async function updateAuth() {
  requireEnv();
  if (!webhookId) usage();
  if (!webhookSecret) {
    console.error("Missing THUMBTACK_WEBHOOK_SECRET");
    process.exit(1);
  }
  console.log("Updating webhook auth:", {
    webhookId,
    username: webhookUser,
    password: "(hidden)",
  });
  const data = await api(
    `/businesses/${businessId}/webhooks/${webhookId}/auth`,
    {
      method: "PUT",
      body: { username: webhookUser, password: webhookSecret },
    },
  );
  console.log(JSON.stringify(data, null, 2));
}

if (cmd === "list") {
  await listWebhooks();
} else if (cmd === "create") {
  await createWebhook();
} else if (cmd === "enable") {
  await enableWebhook();
} else if (cmd === "update-auth") {
  await updateAuth();
} else {
  usage();
}
